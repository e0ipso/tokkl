/** The owner's graffiti wordmark, named "Tokkl" for screen readers. `npm run icons` derives it from docs/brand. */
import { t } from '../i18n/messages.ts';

/** md fits the sidebar; sm keeps the phone header strip short. */
const WORDMARK_WIDTH = { sm: 84, md: 130, lg: 260 } as const;
/** The wordmark crop in scripts/icons.ts (2059x769). */
const WORDMARK_RATIO = 769 / 2059;
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
        alt={t('shell.appName')}
        width={width}
        height={Math.round(width * WORDMARK_RATIO)}
      />
    </span>
  );
}
