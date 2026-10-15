import { Wordmark } from './Wordmark.tsx';

/**
 * The brand: the app icon beside the drawn "Tokkl" wordmark. The sidebar, the phone header strip and
 * the auth page all render this one component. The wordmark is an image named "Tokkl", so screen
 * readers still hear the name.
 */
const ICON_SIZE = { sm: 24, md: 30, lg: 48 } as const;
/** The md width fits the sidebar beside the icon; sm keeps the phone header strip short. */
const WORDMARK_WIDTH = { sm: 84, md: 130, lg: 260 } as const;

export function Brand({ size = 'md' }: { size?: keyof typeof ICON_SIZE }) {
  const icon = ICON_SIZE[size];
  return (
    <span className={`brand brand-${size}`}>
      <img src="/icon.svg" alt="" width={icon} height={icon} />
      <Wordmark width={WORDMARK_WIDTH[size]} />
    </span>
  );
}
