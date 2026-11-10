import type { Client, Project } from '@tokkl/types';
import { t } from '../../i18n/messages.ts';
import { includesText, matchesStatus, type StatusFilter } from './values.ts';

/** Archived ones included. */
export function projectCountsByClient(projects: readonly Project[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const project of projects) {
    if (project.client_id !== null) counts.set(project.client_id, (counts.get(project.client_id) ?? 0) + 1);
  }
  return counts;
}

export function visibleClients(clients: readonly Client[], status: StatusFilter, search: string): Client[] {
  return clients.filter(
    client =>
      matchesStatus(client.archived, status) &&
      (includesText(client.name, search) || includesText(client.notes, search)),
  );
}

export function archiveNotice(projects: number): string {
  return projects === 0 ? t('manage.archiveNoProjects') : t('manage.archiveProjects', { count: projects });
}

export function deleteNotice(projects: number, name: string): string {
  return projects === 0 ? t('manage.deleteNoProjects') : t('manage.deleteProjectsStay', { count: projects, name });
}
