/** Writes a download as its producer makes it, at the pace the client reads it. */
import type { Response } from 'express';

/** How long a download may wait for the client to take more before the response is dropped. */
export const DOWNLOAD_STALL_MS = 30_000;

/** Takes one piece of the body; resolves once the client took what was written before. */
export type DownloadOutput = (chunk: string) => Promise<void>;

/** Writes `chunk`, then waits for the socket to drain when it asked for a pause. */
function written(res: Response, chunk: string): Promise<void> {
  if (res.destroyed || res.write(chunk)) return Promise.resolve();
  return new Promise(resolve => {
    // A client that stops reading would hold its producer, and the report queue, for good.
    const stalled = setTimeout(() => res.destroy(), DOWNLOAD_STALL_MS);
    const done = () => {
      clearTimeout(stalled);
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });
}

/**
 * Runs `produce` with an output that writes to `res`, and ends the response once it settles. The
 * status and `headers` go out with the first piece, so a failure before it still gets its own error
 * reply. A failure after it has no reply left to change: the connection is dropped, and the client
 * sees a cut-off download rather than a complete-looking one.
 */
export async function streamDownload(
  res: Response,
  headers: Record<string, string>,
  produce: (output: DownloadOutput) => Promise<void>,
): Promise<void> {
  let started = false;
  try {
    await produce(chunk => {
      if (!started) {
        started = true;
        res.set(headers);
      }
      return written(res, chunk);
    });
  } catch (error) {
    if (!started) throw error;
    res.destroy();
    return;
  }
  res.end();
}
