import express, { type Router } from 'express';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Reread when the file changes, so a rebuild never leaves the server pointing at deleted assets. */
function appShell(path: string): () => Promise<string> {
  let cached: { mtimeMs: number; size: number; html: string } | undefined;
  return async () => {
    const { mtimeMs, size } = await stat(path);
    if (!cached || cached.mtimeMs !== mtimeMs || cached.size !== size)
      cached = { mtimeMs, size, html: await readFile(path, 'utf8') };
    return cached.html;
  };
}

/** Or a plain hint at `/` when the app has not been built. */
export function webRootRoutes(webRoot: string): Router {
  const router = express.Router();
  const indexPath = join(webRoot, 'index.html');
  if (!existsSync(indexPath)) {
    router.get('/', (_req, res) => {
      res.type('text').send('Web UI not built. Run "npm run build" or use the dev server on port 5173.');
    });
    return router;
  }
  // Hashed assets never change, so they can be cached for good. A miss must not fall through to
  // index.html, or a browser would cache HTML under a script URL for a year.
  router.use(
    '/assets',
    express.static(join(webRoot, 'assets'), {
      immutable: true,
      maxAge: '365d',
      fallthrough: false,
    }),
  );
  router.use(express.static(webRoot, { index: false }));
  const shell = appShell(indexPath);
  // Every other path is a client-side route of the app.
  router.get('/{*path}', async (_req, res) => {
    res
      .set('Cache-Control', 'no-cache')
      .type('html')
      .send(await shell());
  });
  return router;
}
