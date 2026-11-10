import type { Response } from 'express';

/** How long a download may wait for the client to read before the response is dropped. */
const DOWNLOAD_STALL_MS = 30_000;

/** Resolves once the client took what was written before. */
type DownloadOutput = (chunk: string) => Promise<void>;

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

/** Headers go with the first piece; an earlier failure gets its error reply, a later one drops the connection. */
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
