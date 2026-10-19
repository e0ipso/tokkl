/**
 * The brand: the owner's graffiti "Tokkl" wordmark, alone. The sidebar, the phone header strip,
 * the auth page and the splash all render this one component. The image is named "Tokkl", so
 * screen readers still hear the name. The app icon appears only as the browser and OS icon.
 *
 * The images are derived from the artwork in docs/brand by `npm run icons`.
 */
/** The md width fits the sidebar; sm keeps the phone header strip short. */
const WORDMARK_WIDTH = { sm: 84, md: 130, lg: 260 } as const;
/** Height over width of the cropped wordmark in scripts/icons.ts (1645x709). */
const WORDMARK_RATIO = 709 / 1645;
const WORDMARK_SRCSET = '/brand/wordmark-260.png 260w, /brand/wordmark-520.png 520w';

export function Brand({ size = 'md' }: { size?: keyof typeof WORDMARK_WIDTH }) {
  const width = WORDMARK_WIDTH[size];
  return (
    <span className={`brand brand-${size}`}>
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
