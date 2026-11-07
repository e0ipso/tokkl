import type { IconName } from '../components/Icon.tsx';

/** A section's hue: styles/shell.css maps each to a fill and the text colour on it (data-section). */
export type Section = 'timer' | 'pomodoro' | 'reports' | 'projects' | 'settings' | 'more';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  section: Section;
  inMore?: true;
  adminOnly?: true;
}

/**
 * Every page in the navigation. On phones the inMore items move from the bottom bar into the More
 * sheet. Reports keeps its own hue there; the other inMore items take More's. adminOnly items show
 * only to admins; the server still refuses everyone else.
 */
export const NAV: readonly NavItem[] = [
  { href: '/', label: 'Timer', icon: 'timer', section: 'timer' },
  { href: '/pomodoro', label: 'Pomodoro', icon: 'tomato', section: 'pomodoro' },
  { href: '/reports', label: 'Reports', icon: 'chart', section: 'reports', inMore: true },
  { href: '/projects', label: 'Projects', icon: 'folder', section: 'projects' },
  { href: '/clients', label: 'Clients', icon: 'users', section: 'more', inMore: true },
  { href: '/tags', label: 'Tags', icon: 'tag', section: 'more', inMore: true },
  { href: '/trash', label: 'Trash', icon: 'trash', section: 'more', inMore: true },
  { href: '/admin', label: 'Admin', icon: 'shield', section: 'more', inMore: true, adminOnly: true },
  { href: '/settings', label: 'Settings', icon: 'settings', section: 'settings' },
];

/** The phone breakpoint; styles/shell.css uses the same max-width for the bottom bar. */
export const PHONE_QUERY = '(max-width: 760px)';

/** Whether `href` is the open page: the timer only at "/", every other page with its subpaths. */
export function isActive(href: string, location: string): boolean {
  return href === '/' ? location === '/' : location.startsWith(href);
}

/** The open page's section hue; pages read it for their stickers. Every route is in NAV, Admin too. */
export function sectionOf(location: string): Section {
  return NAV.find(item => isActive(item.href, location))?.section ?? 'timer';
}
