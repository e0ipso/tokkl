/**
 * The wordmark: the app icon beside the name in the display face. The sidebar, the phone header
 * strip and the auth page all render this one component, so the drawn wordmark (TT-0114) and the
 * rename (TT-0113) change it in one place.
 */
const ICON_SIZE = { sm: 24, md: 30, lg: 48 } as const;

export function Brand({ size = 'md' }: { size?: keyof typeof ICON_SIZE }) {
  const icon = ICON_SIZE[size];
  return (
    <span className={`brand brand-${size}`}>
      <img src="/icon.svg" alt="" width={icon} height={icon} />
      <span className="brand-name">Timetrack</span>
    </span>
  );
}
