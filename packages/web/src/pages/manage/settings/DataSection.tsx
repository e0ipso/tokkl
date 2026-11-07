import { ExportData } from './ExportData.tsx';
import { RestoreJson } from './RestoreJson.tsx';
import { SettingsCard } from './SettingsCard.tsx';
import { TogglImport } from './TogglImport.tsx';

/** The Data card: exports, the Toggl CSV import and the Tokkl JSON restore. */
export function DataSection({ timeZone }: { timeZone: string }) {
  return (
    <SettingsCard id="data" title="Data">
      <ExportData />
      <TogglImport timeZone={timeZone} />
      <RestoreJson />
    </SettingsCard>
  );
}
