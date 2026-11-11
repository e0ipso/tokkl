import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import nodemailer from 'nodemailer';
import { createMailer } from '../src/mail.ts';

test('mail transport failures expose no SMTP diagnostics or credentials', async t => {
  t.mock.method(nodemailer, 'createTransport', () => ({
    async sendMail() {
      throw new Error('SMTP rejected private-user private-password');
    },
  }));
  const mailer = createMailer({
    host: 'smtp.example.com',
    port: 587,
    tls: 'starttls',
    from: 'sender@example.com',
    user: 'private-user',
    password: 'private-password',
  });
  await assert.rejects(
    mailer.send({ to: 'recipient@example.com', subject: 'Invite', text: 'Open your link.' }),
    (error: Error) => error.message === 'Mail delivery failed' && !/private-user|private-password/.test(inspect(error)),
  );
  assert.doesNotMatch(JSON.stringify(mailer), /private-user|private-password/);
});
