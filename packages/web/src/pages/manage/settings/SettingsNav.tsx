import { Link, Redirect, useLocation } from 'wouter';
import { t, type MessageKey } from '../../../i18n/messages.ts';

type Section = readonly [string, MessageKey];

interface SectionNavigation {
  base: string;
  sections: readonly [Section, ...Section[]];
}

export function SettingsNav({ base, sections, label }: SectionNavigation & { label: string }) {
  const [location] = useLocation();
  return (
    <nav className="settings-nav" aria-label={label}>
      {sections.map(([id, title]) => {
        const href = `${base}/${id}`;
        return (
          <Link key={id} href={href} aria-current={location === href ? 'page' : undefined}>
            {t(title)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Keep bookmarked section anchors working after sections became separate pages. */
export function SettingsRedirect({ base, sections }: SectionNavigation) {
  const [location] = useLocation();
  const hash = window.location.hash.slice(1);
  const section = location === base && sections.some(([id]) => id === hash) ? hash : sections[0][0];
  return <Redirect to={`${base}/${section}`} replace />;
}
