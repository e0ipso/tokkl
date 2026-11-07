import type { MessageGroup } from '../catalog.ts';

/** Signing in and the pages reached while signed out: setup, login, invite and password reset. */
export const auth = {
  setupTitle: 'Create the first admin',
  setupIntro:
    "This creates the server's first administrator. You can invite more people afterwards. The setup code is printed in the server log.",
  setupCode: 'Setup code',
  name: 'Name',
  email: 'Email',
  password: 'Password',
  logIn: 'Log in',
  createAdmin: 'Create admin account',

  /** A link check that failed for another reason than the link, such as the server being down. */
  checkFailed: '{prefix}: {message}',
  goToLogIn: 'Go to log in',

  checkingInvite: 'Checking your invite…',
  inviteInvalid: 'Invite link not valid',
  inviteCheckFailed: "Can't check this invite",
  createYourAccount: 'Create your account',
  invitedAdmin: 'You are invited as an administrator of this Tokkl server. Your entries stay private to your account.',
  invitedUser: 'You are invited to track time on this Tokkl server. Your entries stay private to your account.',
  createAccount: 'Create account',

  checkingReset: 'Checking your reset link…',
  resetInvalid: 'Reset link not valid',
  resetCheckFailed: "Can't check this reset link",
  passwordChanged: 'Password changed',
  passwordChangedBody:
    'Log in as {email} with your new password. Every browser that was signed in to this account is now signed out.',
  setNewPassword: 'Set a new password',
  chooseNewPassword: 'Choose a new password for {email}. This link works once.',
  newPassword: 'New password',
  setPassword: 'Set password',
} as const satisfies MessageGroup;
