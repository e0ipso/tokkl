import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver, type QueryKey, type QueryObserverOptions } from '@tanstack/react-query';
import { detailedEntriesOptions, reportOptions, weeklyReportOptions, type ReportFilterBody } from './reports.ts';

interface Held {
  readonly path: string;
  readonly method: string | undefined;
  readonly signal: AbortSignal;
}

function holding() {
  const requests: Held[] = [];
  const fetch = (path: string, init: RequestInit) => {
    const signal = init.signal!;
    requests.push({ path, method: init.method, signal });
    return new Promise<never>((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  };
  return { fetch, requests };
}

const settled = () => new Promise(resolve => setTimeout(resolve, 0));

const week: ReportFilterBody = { start_date: '2026-11-02', end_date: '2026-11-08' };
const month: ReportFilterBody = { start_date: '2026-11-01', end_date: '2026-11-30' };

/** One observer whose options follow the filters; `replace` switches to `next`, as a filter change does. */
function view<TQueryFnData, TData, TKey extends QueryKey>(
  qc: QueryClient,
  first: QueryObserverOptions<TQueryFnData, Error, TData, TQueryFnData, TKey>,
  next: QueryObserverOptions<TQueryFnData, Error, TData, TQueryFnData, TKey>,
) {
  const observer = new QueryObserver(qc, first);
  const unsubscribe = observer.subscribe(() => {});
  return { replace: () => observer.setOptions(next), close: unsubscribe };
}

const cases = [
  {
    name: 'report',
    path: '/api/app/report',
    open: (qc: QueryClient) => view(qc, reportOptions(week), reportOptions(month)),
  },
  {
    name: 'detailed entries',
    path: '/api/app/report/entries',
    open: (qc: QueryClient) =>
      view(
        qc,
        detailedEntriesOptions(week, { sort: 'date', dir: 'desc' }, 1),
        detailedEntriesOptions(week, { sort: 'date', dir: 'desc' }, 2),
      ),
  },
  {
    name: 'weekly report',
    path: '/api/app/report/weekly',
    open: (qc: QueryClient) => view(qc, weeklyReportOptions(week, 'projects'), weeklyReportOptions(week, 'clients')),
  },
];

for (const { name, path, open } of cases) {
  test(`a ${name} query the filters replace aborts its request`, async t => {
    const { fetch, requests } = holding();
    t.mock.method(globalThis, 'fetch', fetch);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shown = open(qc);
    t.after(() => {
      shown.close();
      qc.clear();
    });
    await settled();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.path, path);
    assert.equal(requests[0]!.method, 'POST');

    shown.replace();
    await settled();
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.signal.aborted, true, 'the replaced report is cancelled');
    assert.equal(requests[1]!.signal.aborted, false, 'the current report goes on');
  });
}
