import { runExportJob, type ExportAssemblyJob, type ExportSource } from '../../src/services/exportJobs.ts';
import type { Client, Project, Tag, Task, TimeEntry, Workspace } from '@tokkl/types';

interface JsonExport {
  [key: string]: unknown;
  workspaces: Workspace[];
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  tags: Tag[];
  time_entries: TimeEntry[];
}

export async function exportBody(source: ExportSource, userId: number, assembly: ExportAssemblyJob): Promise<string> {
  const chunks: string[] = [];
  await runExportJob(source, { userId, assembly }, async chunk => {
    chunks.push(chunk);
  });
  return chunks.join('');
}

export async function buildJsonExport(source: ExportSource, userId: number, exportedAt = new Date().toISOString()) {
  const body = await exportBody(source, userId, { kind: 'export-json', exportedAt, filename: 'tokkl.json' });
  return JSON.parse(body) as JsonExport;
}

export function buildCsvExport(source: ExportSource, userId: number, range: { from?: string; to?: string }) {
  return exportBody(source, userId, { kind: 'export-csv', range, filename: 'tokkl.csv' });
}
