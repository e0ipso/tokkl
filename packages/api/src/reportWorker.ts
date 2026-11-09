/**
 * The entry point of a report worker thread: it opens its own read-only reader for the storage
 * configuration in `workerData` and runs the jobs the runner posts, one at a time.
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { StorageConfig } from './storage/config.ts';
import { openReportReader } from './storage/repositories/report-reader.ts';
import type { ReportWork } from './services/reportExecution.ts';
import { EXPORT_BYTES_AHEAD } from './services/exportJobs.ts';
import { isDownload, runDownloadJob } from './services/downloadJobs.ts';
import { runReportJob } from './services/reportJobs.ts';
import { ApplicationError } from './lib/errors.ts';
import { redactedDiagnostic } from './lib/logger.ts';

interface ReportRequest {
  id: number;
  work: ReportWork;
}
/** The parent took `bytes` of export `id`'s output. */
interface Acknowledgement {
  ack: { id: number; bytes: number };
}

/**
 * The export output sent and not yet acknowledged. An export waits while more than
 * EXPORT_BYTES_AHEAD is out, and finishes only once all of it was taken.
 */
class OutputCredit {
  readonly id: number;
  private ahead = 0;
  private wake: (() => void) | undefined;
  constructor(id: number) {
    this.id = id;
  }
  taken(bytes: number): void {
    this.ahead -= bytes;
    this.wake?.();
  }
  /** Resolves once at most `limit` bytes are out. */
  async within(limit: number): Promise<void> {
    while (this.ahead > limit)
      await new Promise<void>(resolve => {
        this.wake = resolve;
      });
    this.wake = undefined;
  }
  sent(bytes: number): void {
    this.ahead += bytes;
  }
}

const port = parentPort!;
try {
  const reader = await openReportReader(workerData as StorageConfig);
  let work: Promise<void> = Promise.resolve();
  let credit: OutputCredit | undefined;
  port.on('message', (message: ReportRequest | Acknowledgement | { close: true }) => {
    // Acknowledgements arrive while an export runs, so they never wait in the job chain.
    if ('ack' in message) {
      if (credit?.id === message.ack.id) credit.taken(message.ack.bytes);
      return;
    }
    work = work
      .then(async () => {
        if ('close' in message) {
          await reader.close();
          port.close();
          return;
        }
        const { id, work } = message;
        try {
          if (isDownload(work)) {
            const output = (credit = new OutputCredit(id));
            await runDownloadJob(reader, work, async chunk => {
              const bytes = Buffer.byteLength(chunk);
              port.postMessage({ id, chunk, bytes });
              output.sent(bytes);
              await output.within(EXPORT_BYTES_AHEAD);
            });
            await output.within(0);
            port.postMessage({ id });
            return;
          }
          const result = await runReportJob(reader, work);
          port.postMessage({ id, result });
        } catch (error) {
          // SQL/driver messages never leave this thread. An unexpected failure sends its redacted
          // diagnostic for the parent's log; the client still gets the fixed message.
          port.postMessage(
            error instanceof ApplicationError
              ? { id, error: { kind: error.kind, message: error.message, retryAfterSeconds: error.retryAfterSeconds } }
              : { id, error: { message: 'Report failed' }, diagnostic: redactedDiagnostic(error) },
          );
        } finally {
          credit = undefined;
        }
      })
      .catch(async () => {
        try {
          await reader.close();
        } finally {
          port.close();
        }
      });
  });
  port.postMessage({ ready: true });
} catch (error) {
  // Startup errors can contain connection credentials, so only the redacted diagnostic is sent.
  port.postMessage({ startupFailed: redactedDiagnostic(error) });
  port.close();
}
