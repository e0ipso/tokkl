import type { Page, Response, TestInfo } from '@playwright/test';

export interface RuntimeIssue {
  kind: 'pageerror' | 'console' | 'response' | 'requestfailed';
  text: string;
}

/** A failed response a scenario provokes on purpose. Every rule must say why it is expected. */
export interface AllowedResponse {
  status: number;
  method: string;
  path: RegExp;
  reason: string;
}

// The app asks /api/v9/me on load to find out whether it is logged in. Without a session cookie
// the API answers 403 and the app shows the login page, so a 403 is expected for any API request
// sent without the cookie. A 403 that carries the cookie still fails the scenario.
const SESSION_COOKIE = /(?:^|;\s*)tokkl_session=/;

async function isLoggedOutProbe(response: Response): Promise<boolean> {
  if (response.status() !== 403 || !new URL(response.url()).pathname.startsWith('/api/')) return false;
  const headers = await response.request().allHeaders();
  return !SESSION_COOKIE.test(headers.cookie ?? '');
}

/**
 * Collects uncaught page errors, console errors, error responses and failed requests while a
 * scenario runs, then fails the scenario if any of them was not allowed. React logs errors that
 * ErrorBoundary catches with console.error, so those count too.
 */
export class RuntimeErrors {
  readonly issues: RuntimeIssue[] = [];
  private readonly allowed: AllowedResponse[] = [];
  private readonly pending: Array<Promise<void>> = [];

  constructor(page: Page) {
    page.on('pageerror', (error) => this.issues.push({ kind: 'pageerror', text: error.stack ?? error.message }));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // Chromium also logs every failed load as "Failed to load resource: ...". The response and
      // requestfailed listeners record those same failures, and only there can a rule allow one.
      if (message.text().startsWith('Failed to load resource:')) return;
      this.issues.push({ kind: 'console', text: message.text() });
    });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      this.pending.push(this.checkResponse(response));
    });
    page.on('requestfailed', (request) => {
      this.issues.push({ kind: 'requestfailed', text: `${request.method()} ${request.url()}: ${request.failure()?.errorText}` });
    });
  }

  /** Lets the current scenario provoke one kind of failed response. */
  allowResponse(rule: AllowedResponse): void {
    this.allowed.push(rule);
  }

  private async checkResponse(response: Response): Promise<void> {
    const method = response.request().method();
    const path = new URL(response.url()).pathname;
    const status = response.status();
    if (this.allowed.some((rule) => rule.status === status && rule.method === method && rule.path.test(path))) return;
    if (await isLoggedOutProbe(response)) return;
    this.issues.push({ kind: 'response', text: `${status} ${method} ${response.url()}` });
  }

  /** Waits for pending checks, attaches what was found and throws if anything was unexpected. */
  async verify(testInfo: TestInfo): Promise<void> {
    await Promise.all(this.pending);
    if (this.issues.length === 0) return;
    await testInfo.attach('runtime-errors.json', { body: JSON.stringify(this.issues, null, 2), contentType: 'application/json' });
    const lines = this.issues.map((issue) => `- ${issue.kind}: ${issue.text.split('\n')[0]}`);
    throw new Error(`Unexpected runtime errors during the scenario:\n${lines.join('\n')}`);
  }
}
