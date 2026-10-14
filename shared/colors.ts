/** Project colors offered by the picker. Matches the palette Toggl Track uses for new projects. */
export const PROJECT_COLORS = [
  '#0b83d9', '#9e5bd9', '#d94182', '#e36a00', '#bf7000', '#c7af14', '#d92b2b',
  '#2da608', '#06a893', '#c9806b', '#465bb3', '#990099', '#566614', '#525266',
] as const;

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
