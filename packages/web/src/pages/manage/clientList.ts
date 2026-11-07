import type { Client, Project } from '../../api/types.ts';
import { plural } from '../../lib/format.ts';
import { includesText, matchesStatus, type StatusFilter } from './values.ts';

/** The rules behind the Clients page: project counts, the filtered list and what each dialog says. */

/** How many projects, archived ones included, each client has. */
export function projectCountsByClient(projects: readonly Project[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const project of projects) {
    if (project.client_id !== null) counts.set(project.client_id, (counts.get(project.client_id) ?? 0) + 1);
  }
  return counts;
}

/** The clients with the chosen status whose name or notes contain the search. */
export function visibleClients(clients: readonly Client[], status: StatusFilter, search: string): Client[] {
  return clients.filter(
    client =>
      matchesStatus(client.archived, status) &&
      (includesText(client.name, search) || includesText(client.notes, search)),
  );
}

/** What archiving a client with `projects` projects does to them. */
export function archiveNotice(projects: number): string {
  return projects === 0
    ? 'It has no projects right now.'
    : `This also archives its ${plural(projects, 'project')}. Archived projects keep their time entries but don't show up when you pick a project.`;
}

/** What deleting the client `name` with `projects` projects does to them. */
export function deleteNotice(projects: number, name: string): string {
  const stay =
    projects === 0
      ? 'It has no projects.'
      : projects === 1
        ? 'Its project stays, without a client.'
        : `Its ${projects} projects stay, without a client.`;
  const rename =
    projects === 0
      ? ''
      : ` If a project without a client already has the same name, "(${name})" is added to the moved one.`;
  return `${stay}${rename} Time entries don't change. You can't undo this.`;
}
