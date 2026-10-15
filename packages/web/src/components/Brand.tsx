/**
 * The brand: the app icon beside the owner's graffiti "Tokkl" wordmark. The sidebar, the phone header
 * strip, the auth page and the splash all render this one component. The wordmark image is named
 * "Tokkl", so screen readers still hear the name; the icon beside it is decorative.
 *
 * The images are derived from the artwork in docs/brand by `npm run icons`.
 */
const ICON_SIZE = { sm: 24, md: 30, lg: 48 } as const;
/** The md width fits the sidebar beside the icon; sm keeps the phone header strip short. */
const WORDMARK_WIDTH = { sm: 84, md: 130, lg: 260 } as const;
/** Height over width of the cropped wordmark in scripts/icons.ts (1645x709). */
const WORDMARK_RATIO = 709 / 1645;
const WORDMARK_SRCSET = '/brand/wordmark-260.png 260w, /brand/wordmark-520.png 520w';

export function Brand({ size = 'md' }: { size?: keyof typeof ICON_SIZE }) {
  const icon = ICON_SIZE[size];
  const width = WORDMARK_WIDTH[size];
  return (
    <span className={`brand brand-${size}`}>
      <img src="/brand/icon-96.png" alt="" width={icon} height={icon} />
      <img
        className="wordmark"
        src="/brand/wordmark-260.png"
        srcSet={WORDMARK_SRCSET}
        sizes={`${width}px`}
        alt="Tokkl"
        width={width}
        height={Math.round(width * WORDMARK_RATIO)}
      />
    </span>
  );
}
