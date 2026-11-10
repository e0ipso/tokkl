import type { RequestHandler } from 'express';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** A same-origin CSP, no framing, no sniffing, no referrer. */
export const securityHeaders: RequestHandler = (req, res, next) => {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  // Only meaningful over HTTPS, which here means "the reverse proxy said so".
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
};

/** API answers depend on who asks, so no cache may keep them. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};
