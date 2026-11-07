/** Parses an optional non-negative number field. Empty means null; anything invalid means undefined. */
export function parseOptionalAmount(raw: string): number | null | undefined {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function includesText(haystack: string | null | undefined, query: string): boolean {
  return (haystack ?? '').toLowerCase().includes(query.trim().toLowerCase());
}
