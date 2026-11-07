import { ExportData } from './ExportData.tsx';
import { RestoreJson } from './RestoreJson.tsx';
import { SettingsCard } from './SettingsCard.tsx';
import { TogglImport } from './TogglImport.tsx';
import { t } from '../../../i18n/messages.ts';

/** The Data card: exports, the Toggl CSV import and the Tokkl JSON restore. */
export function DataSection({ timeZone }: { timeZone: string }) {
  return (
    <SettingsCard id="data" title={t('settings.sectionData')}>
      <ExportData />
      <TogglImport timeZone={timeZone} />
      <RestoreJson />
    </SettingsCard>
  );
}
