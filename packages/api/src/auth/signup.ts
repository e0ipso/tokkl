import type { RequestHandler } from 'express';
import type { AccountRunner } from '../domain/accountGuards.ts';
import { getInstanceSettings, signupEffective } from '../domain/instanceSettings.ts';
import { isEmailAddress, MAX_ACCOUNT_TEXT_LENGTH, normalizeEmail } from '../domain/accountValues.ts';
import { clientAddress, readJson } from '../http/request.ts';
import { ApplicationError, invalidInput, notFound, tooManyAttempts } from '../lib/errors.ts';
import type { Mailer } from '../mail.ts';
import type { ApplicationServices } from '../services/application.ts';
import { requireCsrfHeader } from './middleware.ts';
import type { FailureLimiter } from './rateLimit.ts';

interface SignupOptions {
  sessionDays: number;
  mailConfigured: boolean;
  publicUrl: string | undefined;
  mailer: Mailer | undefined;
  signupAddressLimiter: FailureLimiter;
  signupEmailLimiter: FailureLimiter;
}

export function createSignupHandler(
  runner: Pick<AccountRunner, 'readSnapshot'>,
  operations: ApplicationServices['signupInvites'],
  options: SignupOptions,
): RequestHandler {
  return async (req, res) => {
    requireCsrfHeader(req);
    const settings = await runner.readSnapshot(ctx => getInstanceSettings(ctx, options.sessionDays));
    const { mailer, publicUrl } = options;
    if (!signupEffective(settings, options.mailConfigured) || !mailer || !publicUrl) throw notFound();
    // Count and release each reservation before the account transaction or SMTP send.
    const address = await options.signupAddressLimiter.attempt(clientAddress(req), async () => false);
    if (address.refused) throw tooManyAttempts('Too many sign-up requests, try again later', address.retryAfter);
    const body = readJson(req);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!isEmailAddress(email) || email.length > MAX_ACCOUNT_TEXT_LENGTH)
      throw invalidInput('Enter a valid email address');
    const target = await options.signupEmailLimiter.attempt(normalizeEmail(email), async () => false);
    if (target.refused) throw tooManyAttempts('Too many sign-up requests, try again later', target.retryAfter);
    const result = await operations.createSignupInvite(email);
    const message = result.existing
      ? {
          subject: 'Your Tokkl account',
          text: 'This email address already has an account. Ask your admin for a password reset link.',
        }
      : {
          subject: 'Your Tokkl sign-up link',
          text: `Create your Tokkl account using this link:\n${publicUrl}/invite/${result.token}\n\nThis link expires in ${(Date.parse(result.invite.expiresAt) - Date.parse(result.invite.createdAt)) / 86400000} days.`,
        };
    try {
      await mailer.send({ to: email, ...message });
    } catch {
      res.locals.log.error('Sign-up email failed');
      if (!result.existing) {
        try {
          await operations.deleteSignupInvite(result.invite.id, result.token);
        } catch {
          res.locals.log.error('Sign-up invite cleanup failed');
        }
      }
      throw new ApplicationError('unavailable', 'Could not send the email. Try again later.');
    }
    res.status(202).json({ ok: true });
  };
}
