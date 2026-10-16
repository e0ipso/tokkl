/**
 * Keeps keyboard focus in a table when a row goes away. Rows carry `data-id`; the controls focus can
 * move to carry `data-row-action`, such as "menu" on `RowMenu`'s button.
 */

/** The enabled `action` control in the row of `id`, matched by the rows' data-id and data-row-action. */
export function rowAction(tbody: HTMLTableSectionElement | null, id: number, action: string): HTMLElement | null {
  return tbody?.querySelector<HTMLElement>(`tr[data-id="${id}"] [data-row-action="${action}"]:not(:disabled)`) ?? null;
}

/**
 * Moves focus off the row of `id` before it goes away, so a keyboard user keeps their place: to the
 * same `action` control in the nearest row after it that has one, else the nearest row before it,
 * else `fallback`.
 */
export function focusPastRow(tbody: HTMLTableSectionElement | null, id: number, action: string, fallback: HTMLElement | null): void {
  const rows = [...(tbody?.rows ?? [])];
  const index = rows.findIndex((row) => row.dataset.id === String(id));
  const others = index < 0 ? [] : [...rows.slice(index + 1), ...rows.slice(0, index).reverse()];
  const target = others
    .map((row) => row.querySelector<HTMLElement>(`[data-row-action="${action}"]:not(:disabled)`))
    .find((control) => control !== null);
  (target ?? fallback)?.focus();
}

/**
 * `focusPastRow`, but only when focus would otherwise be lost: it is in the row of `id` or already
 * on the body. Focus the user has moved elsewhere while a request ran stays where it is.
 */
export function keepFocusPastRow(tbody: HTMLTableSectionElement | null, id: number, action: string, fallback: HTMLElement | null): void {
  const active = document.activeElement;
  const row = tbody?.querySelector(`tr[data-id="${id}"]`);
  if (!active || active === document.body || row?.contains(active)) focusPastRow(tbody, id, action, fallback);
}
