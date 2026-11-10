import { expect, test } from './fixtures.ts';
import { expectFits, expectNoPageOverflow } from './mobile-tests-helpers.ts';

for (const signupEnabled of [false, undefined]) {
  test(`login hides signup when the server reports ${signupEnabled}`, async ({ page }) => {
    await page.route('**/api/app/status', route =>
      route.fulfill({ json: { setup_required: false, signup_enabled: signupEnabled } }),
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0);
  });
}

test('an enabled server offers signup and focuses the neutral accepted message', async ({ page }) => {
  await page.route('**/api/app/status', route =>
    route.fulfill({ json: { setup_required: false, signup_enabled: true } }),
  );
  await page.route('**/api/app/signup', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-tokkl-csrf']).toBe('1');
    expect(route.request().postDataJSON()).toEqual({ email: 'visitor@example.com' });
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.getByLabel('Email').fill('visitor@example.com');
  await page.getByRole('button', { name: 'Send sign-up link' }).click();
  const result = page.getByRole('status').filter({ hasText: 'Check your inbox' });
  await expect(result).toBeFocused();
  await expect(result).toContainText('Check your email for the next steps.');
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await page.getByRole('link', { name: 'Go to log in' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});

test('signup field errors focus email and clear on typing; throttling includes Retry-After', async ({
  page,
  runtimeErrors,
}) => {
  for (const status of [400, 429]) {
    runtimeErrors.allowResponse({ status, method: 'POST', path: /^\/api\/app\/signup$/, reason: 'Form feedback' });
  }
  let attempt = 0;
  await page.route('**/api/app/signup', route => {
    attempt++;
    return attempt === 1
      ? route.fulfill({ status: 400, json: 'Invalid email' })
      : route.fulfill({ status: 429, json: 'Too many sign-up requests', headers: { 'Retry-After': '123' } });
  });
  await page.goto('/signup');
  const email = page.getByLabel('Email');
  await email.fill('visitor@example.com');
  await page.getByRole('button', { name: 'Send sign-up link' }).click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAccessibleDescription('Invalid email');
  await email.fill('corrected@example.com');
  await expect(email).not.toHaveAttribute('aria-invalid');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send sign-up link' }).click();
  await expect(page.getByRole('alert')).toHaveText('Too many sign-up requests. Try again in 123 seconds.');
  await expect(page.getByRole('button', { name: 'Send sign-up link' })).toBeEnabled();
});

test('signup becoming unavailable replaces the form and offers login', async ({ page, runtimeErrors }) => {
  runtimeErrors.allowResponse({ status: 404, method: 'POST', path: /^\/api\/app\/signup$/, reason: 'Signup is off' });
  await page.route('**/api/app/signup', route => route.fulfill({ status: 404, json: 'Not found' }));
  await page.goto('/signup');
  await page.getByLabel('Email').fill('visitor@example.com');
  await page.getByRole('button', { name: 'Send sign-up link' }).click();
  await expect(page.getByRole('alert')).toContainText('Sign-up is not available on this server.');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await page.getByRole('link', { name: 'Go to log in' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});

for (const width of [375, 1280]) {
  test(`signup and locked invite fit a ${width}px screen`, async ({ page, runtimeErrors }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const lockedEmail = 'long.invited.address.for.phone.layout@example.com';
    let submittedEmail: string | undefined;
    runtimeErrors.allowResponse({
      status: 400,
      method: 'POST',
      path: /^\/api\/app\/invites\/signup-token$/,
      reason: 'Keep invite form visible after checking the submitted email',
    });
    await page.route('**/api/app/invites/signup-token', route => {
      if (route.request().method() === 'POST') {
        submittedEmail = (route.request().postDataJSON() as { email: string }).email;
        return route.fulfill({ status: 400, json: 'Please choose another password' });
      }
      return route.fulfill({ json: { role: 'user', email: lockedEmail } });
    });
    await page.route('**/api/app/signup', route => route.fulfill({ status: 202, json: { accepted: true } }));
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto('/signup');
      await expect(page.getByLabel('Email')).toBeVisible();
      await expectFits(page.locator('.auth-card'));
      await expectFits(page.getByLabel('Email'));
      await expectNoPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`signup-${colorScheme}.png`), fullPage: true });
      await page.getByLabel('Email').fill('visitor@example.com');
      await page.getByRole('button', { name: 'Send sign-up link' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Check your inbox' })).toBeFocused();
      await expectFits(page.locator('.auth-card'));
      await expectNoPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`signup-accepted-${colorScheme}.png`), fullPage: true });
    }
    await page.goto('/invite/signup-token');
    const email = page.getByLabel('Email');
    await expect(email).toHaveValue(lockedEmail);
    await expect(email).toHaveAttribute('readonly');
    await expect(email).toHaveAttribute('aria-readonly', 'true');
    await email.focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('changed@example.com');
    await expect(email).toHaveValue(lockedEmail);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expectFits(page.locator('.auth-card'));
      await expectFits(email);
      await expectNoPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`invite-locked-${colorScheme}.png`), fullPage: true });
    }
    await page.getByLabel('Name').fill('Invited visitor');
    await page.getByLabel('Password').fill('visitor password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toHaveText('Please choose another password');
    expect(submittedEmail).toBe(lockedEmail);
  });
}
