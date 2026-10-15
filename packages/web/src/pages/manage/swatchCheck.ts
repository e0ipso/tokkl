/** WCAG 2 relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// The values of --swatch-check-light and --swatch-check-dark in styles.css; change them together.
const CHECK_LIGHT = luminance('#ffffff');
const CHECK_DARK = luminance('#0b1026');

/**
 * The check token with the higher contrast against the swatch. The swatch is the raw hex in both
 * themes, so the choice depends on the hex alone.
 */
export function checkColor(hex: string): string {
  const l = luminance(hex);
  const onDark = (CHECK_LIGHT + 0.05) / (l + 0.05);
  const onLight = (l + 0.05) / (CHECK_DARK + 0.05);
  return onLight >= onDark ? 'var(--swatch-check-dark)' : 'var(--swatch-check-light)';
}
