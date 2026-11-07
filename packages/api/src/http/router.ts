import express, { type Router } from 'express';

/**
 * An Express router that records where it is mounted as requests enter it. Express resets
 * `req.baseUrl` when a router hands an error back, so the access log reads the mount from here to
 * name the route that failed.
 */
export function createRouter(): Router {
  const router = express.Router();
  router.use((req, res, next) => {
    res.locals.mountPath = req.baseUrl;
    next();
  });
  return router;
}
