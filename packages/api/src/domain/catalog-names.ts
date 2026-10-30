function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, /[\uD800-\uDBFF]/.test(value[max - 1] ?? '') ? max - 1 : max);
}
export function detachedProjectName(name: string, clientName: string, attempt: number): string {
  const tail = ` (${clip(clientName, 100)})${attempt > 1 ? ` ${attempt}` : ''}`;
  return clip(name, 255 - tail.length) + tail;
}
