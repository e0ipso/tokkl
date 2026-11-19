import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { daysAgo } from './groups-refresh-tests-helpers.ts';
import { login } from './helpers.ts';
import { openCalendar, todayBlock } from './history-calendar-tests-helpers.ts';
import { SUGGESTION, TimerApi, metadataOf, seedSuggestion, type Metadata } from './timer-tests-helpers.ts';

// The entry editor's description suggests recent entries as the timer bar does (issue #93), wherever the editor opens.

function editorParts(page: Page) {
  const editor = page.getByRole('dialog', { name: 'Edit entry' });
  return {
    editor,
    description: editor.getByRole('combobox', { name: 'Description' }),
    suggestions: editor.getByRole('listbox', { name: 'Suggestions' }),
  };
}

/** The dialog's autofocus lands on the description without opening the list; typing a prefix opens it. */
async function expectQuietOpenThenSuggest(page: Page): Promise<void> {
  const { description, suggestions } = editorParts(page);
  await expect(description).toBeFocused();
  await expect(description).toHaveAttribute('aria-expanded', 'false');
  await expect(suggestions).toBeHidden();
  await description.fill('Sugg');
  await expect(suggestions.getByRole('option', { name: SUGGESTION.description })).toBeVisible();
  await expect(description).toHaveAttribute('aria-expanded', 'true');
}

/** Escape with the list open closes only the list. */
async function expectEscapeKeepsDialog(page: Page): Promise<void> {
  const { editor, description, suggestions } = editorParts(page);
  await description.press('Escape');
  await expect(suggestions).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(description).toBeFocused();
}

/** The editor's own controls show every picked field before Save. */
async function expectPickedDraft(page: Page): Promise<void> {
  const { editor, description, suggestions } = editorParts(page);
  await expect(suggestions).toBeHidden();
  await expect(description).toHaveValue(SUGGESTION.description);
  await expect(editor.getByRole('button', { name: SUGGESTION.label })).toBeVisible();
  await expect(editor.getByRole('button', { name: SUGGESTION.tag })).toBeVisible();
  await expect(editor.getByRole('checkbox', { name: 'Billable' })).toBeChecked();
}

async function saveAndRead(page: Page, id: number): Promise<Metadata> {
  const { editor } = editorParts(page);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  return metadataOf(await (await page.request.get(`/api/v9/me/time_entries/${id}`)).json());
}

async function openFromRow(row: Locator, page: Page): Promise<void> {
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
}

test('the editor from a Reports detailed row and from an entry list row suggests after typing, and a keyboard pick saves every field', async ({
  page,
}) => {
  await login(page);
  const api = await TimerApi.open(page);
  // Within the last 13 days: Reports read the suggestions from the shared two-week entries query.
  const picked = await seedSuggestion(api, daysAgo(3));
  const target = await api.createEntry({
    description: 'Target entry',
    start: `${daysAgo(1)}T09:00:00Z`,
    stop: `${daysAgo(1)}T10:00:00Z`,
  });
  const { editor, description } = editorParts(page);

  await page.goto('/reports?range=all_time&tab=detailed');
  await page.locator('tr.entry-row', { hasText: 'Target entry' }).click();
  await expectQuietOpenThenSuggest(page);
  await expectEscapeKeepsDialog(page);
  // With the list closed, Escape reaches the dialog again.
  await description.press('Escape');
  await expect(editor).toBeHidden();

  await page.goto('/');
  await openFromRow(page.locator('.entry-line', { has: page.locator('input[value="Target entry"]') }), page);
  await expectQuietOpenThenSuggest(page);
  await expectEscapeKeepsDialog(page);
  await description.press('e');
  const option = editor.getByRole('option', { name: SUGGESTION.description });
  await expect(option).toBeVisible();
  await description.press('ArrowDown');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await description.press('Enter');
  // Enter picked the suggestion; it did not save the dialog.
  await expect(editor).toBeVisible();
  await expectPickedDraft(page);

  expect(await saveAndRead(page, target.id)).toEqual(picked);
});

test('the editor from a week calendar block suggests after typing, and a click pick saves every field', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
  await login(page);
  const api = await TimerApi.open(page);
  const picked = await seedSuggestion(api, '2026-06-12');
  const target = await api.createEntry({
    description: 'Target entry',
    start: '2026-06-15T07:00:00Z',
    stop: '2026-06-15T08:00:00Z',
  });
  await page.reload();
  await openCalendar(page);

  await todayBlock(page, 'Target entry').click();
  await expectQuietOpenThenSuggest(page);
  const { editor } = editorParts(page);
  await editor
    .getByRole('listbox', { name: 'Suggestions' })
    .getByRole('button', { name: new RegExp(SUGGESTION.description) })
    .click();
  await expectPickedDraft(page);

  expect(await saveAndRead(page, target.id)).toEqual(picked);
  await expect(todayBlock(page, SUGGESTION.description)).toBeVisible();
});
