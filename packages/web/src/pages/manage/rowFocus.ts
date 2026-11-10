/** Rows are a container's direct children with `data-id`; controls focus can move to carry `data-row-action`. */

function rowOf(container: HTMLElement | null, id: number): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`:scope > [data-id="${id}"]`) ?? null;
}

export function rowAction(container: HTMLElement | null, id: number, action: string): HTMLElement | null {
  return rowOf(container, id)?.querySelector<HTMLElement>(`[data-row-action="${action}"]:not(:disabled)`) ?? null;
}

/** To the same `action` in the nearest later row that has one, else the nearest earlier row, else `fallback`. */
export function focusPastRow(
  container: HTMLElement | null,
  id: number,
  action: string,
  fallback: HTMLElement | null,
): void {
  const rows = [...(container?.children ?? [])].filter((row): row is HTMLElement => row instanceof HTMLElement);
  const index = rows.findIndex(row => row.dataset.id === String(id));
  const others = index < 0 ? [] : [...rows.slice(index + 1), ...rows.slice(0, index).reverse()];
  const target = others
    .map(row => row.querySelector<HTMLElement>(`[data-row-action="${action}"]:not(:disabled)`))
    .find(control => control !== null);
  (target ?? fallback)?.focus();
}

/** Only when focus would be lost (in the row, or on the body); focus the user moved elsewhere stays. */
export function keepFocusPastRow(
  container: HTMLElement | null,
  id: number,
  action: string,
  fallback: HTMLElement | null,
): void {
  const active = document.activeElement;
  if (!active || active === document.body || rowOf(container, id)?.contains(active))
    focusPastRow(container, id, action, fallback);
}
