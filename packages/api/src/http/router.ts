import express, { type Router } from 'express';

/** Express resets `req.baseUrl` when a router hands an error back, so the access log reads the mount here. */
export function createRouter(): Router {
  const router = express.Router();
  router.use((req, res, next) => {
    res.locals.mountPath = req.baseUrl;
    next();
  });
  return router;
}
