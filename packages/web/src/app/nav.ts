import type { IconName } from '../components/Icon.tsx';
import type { MessageKey } from '../i18n/messages.ts';

/** styles/shell.css maps each to a fill and the text colour on it (data-section). */
export type Section = 'timer' | 'pomodoro' | 'reports' | 'projects' | 'settings' | 'more';

export interface NavItem {
  href: string;
  label: MessageKey;
  icon: IconName;
  section: Section;
  inMore?: true;
  adminOnly?: true;
}

/**
 * On phones inMore items move to the More sheet; only Reports keeps its hue there. The server still refuses
 * non-admins on adminOnly pages.
 */
export const NAV: readonly NavItem[] = [
  { href: '/', label: 'shell.navTimer', icon: 'timer', section: 'timer' },
  { href: '/pomodoro', label: 'shell.navPomodoro', icon: 'tomato', section: 'pomodoro' },
  { href: '/reports', label: 'shell.navReports', icon: 'chart', section: 'reports', inMore: true },
  { href: '/projects', label: 'shell.navProjects', icon: 'folder', section: 'projects' },
  { href: '/clients', label: 'shell.navClients', icon: 'users', section: 'more', inMore: true },
  { href: '/tags', label: 'shell.navTags', icon: 'tag', section: 'more', inMore: true },
  { href: '/trash', label: 'shell.navTrash', icon: 'trash', section: 'more', inMore: true },
  { href: '/admin', label: 'shell.navAdmin', icon: 'shield', section: 'more', inMore: true, adminOnly: true },
  { href: '/settings', label: 'shell.navSettings', icon: 'settings', section: 'settings' },
];

/** styles/shell.css uses the same max-width for the bottom bar. */
export const PHONE_QUERY = '(max-width: 760px)';

/** The timer only at "/", every other page with its subpaths. */
export function isActive(href: string, location: string): boolean {
  return href === '/' ? location === '/' : location.startsWith(href);
}

/** Every route is in NAV, Admin too. */
export function sectionOf(location: string): Section {
  return NAV.find(item => isActive(item.href, location))?.section ?? 'timer';
}
