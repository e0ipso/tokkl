import type { Page, Response, TestInfo } from '@playwright/test';

export interface RuntimeIssue {
  kind: 'pageerror' | 'console' | 'response' | 'requestfailed';
  text: string;
}

/** Every rule must say why it is expected. */
export interface AllowedResponse {
  status: number;
  method: string;
  path: RegExp;
  reason: string;
}

// The app probes /api/v9/me on load, so a 403 without the session cookie is expected; one with it still fails.
const SESSION_COOKIE = /(?:^|;\s*)tokkl_session=/;

// The report endpoints take a POST but only read: the report queries and the CSV reports.
const REPORT_READ = /^\/api\/app\/report(?:\/[\w.]+)?$/;

// A cancelled read is normal (TanStack aborts superseded queries; the app replaces a silent stream; Cancel
// aborts downloads). An aborted write still fails: the app never cancels one and its outcome is unknown.
function isCancelledRead(method: string, url: string, errorText: string | undefined): boolean {
  if (errorText !== 'net::ERR_ABORTED') return false;
  return method === 'GET' || (method === 'POST' && REPORT_READ.test(new URL(url).pathname));
}

async function isLoggedOutProbe(response: Response): Promise<boolean> {
  if (response.status() !== 403 || !new URL(response.url()).pathname.startsWith('/api/')) return false;
  const headers = await response.request().allHeaders();
  return !SESSION_COOKIE.test(headers.cookie ?? '');
}

/** React logs errors ErrorBoundary catches with console.error, so those count too. */
export class RuntimeErrors {
  readonly issues: RuntimeIssue[] = [];
  private readonly allowed: AllowedResponse[] = [];
  private readonly pending: Array<Promise<void>> = [];

  constructor(page: Page) {
    page.on('pageerror', error => this.issues.push({ kind: 'pageerror', text: error.stack ?? error.message }));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // The response and requestfailed listeners record the same failures, and only there can a rule allow one.
      if (message.text().startsWith('Failed to load resource:')) return;
      this.issues.push({ kind: 'console', text: message.text() });
    });
    page.on('response', response => {
      if (response.status() < 400) return;
      this.pending.push(this.checkResponse(response));
    });
    page.on('requestfailed', request => {
      if (isCancelledRead(request.method(), request.url(), request.failure()?.errorText)) return;
      this.issues.push({
        kind: 'requestfailed',
        text: `${request.method()} ${request.url()}: ${request.failure()?.errorText}`,
      });
    });
  }

  allowResponse(rule: AllowedResponse): void {
    this.allowed.push(rule);
  }

  private async checkResponse(response: Response): Promise<void> {
    const method = response.request().method();
    const path = new URL(response.url()).pathname;
    const status = response.status();
    if (this.allowed.some(rule => rule.status === status && rule.method === method && rule.path.test(path))) return;
    if (await isLoggedOutProbe(response)) return;
    this.issues.push({ kind: 'response', text: `${status} ${method} ${response.url()}` });
  }

  async verify(testInfo: TestInfo): Promise<void> {
    await Promise.all(this.pending);
    if (this.issues.length === 0) return;
    await testInfo.attach('runtime-errors.json', {
      body: JSON.stringify(this.issues, null, 2),
      contentType: 'application/json',
    });
    const lines = this.issues.map(issue => `- ${issue.kind}: ${issue.text.split('\n')[0]}`);
    throw new Error(`Unexpected runtime errors during the scenario:\n${lines.join('\n')}`);
  }
}
