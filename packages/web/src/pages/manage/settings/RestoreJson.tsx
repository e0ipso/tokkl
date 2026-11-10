import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidate } from '../../../api/invalidate.ts';
import { stale } from '../../../api/keys.ts';
import { transferRequests } from '../../../api/transfer.ts';
import type { JsonRestoreResult } from '@tokkl/types';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { useAction } from '../../../components/useAction.ts';
import { t } from '../../../i18n/messages.ts';
import { restoreErrorId } from './transferForm.ts';

export function RestoreJson() {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<JsonRestoreResult | null>(null);
  const run = useAction<{ text: string; dryRun: boolean }, JsonRestoreResult>({
    mutationFn: ({ text, dryRun }) => transferRequests.restoreJson(text, dryRun),
    movesTimer: true,
    onSuccess: (restored, { dryRun }) => {
      setResult(restored);
      if (!dryRun) {
        void invalidate(qc, stale.imported);
        toast.show(t('settings.restored', { count: restored.time_entries }));
        setFile(null);
        if (input.current) input.current.value = '';
      }
    },
  });
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    setResult(null);
    if (!selected) return setFile(null);
    const text = await selected.text();
    setFile({ name: selected.name, text });
    run.mutate({ text, dryRun: true });
  };
  return (
    <>
      <h3 className="settings-subheading">{t('settings.restoreTitle')}</h3>
      <p className="hint">{t('settings.restoreHint')}</p>
      <div className="inline-controls settings-row">
        <label className="button button-ghost file-button">
          <Icon name="upload" size={16} /> {t('settings.chooseJson')}
          <input ref={input} type="file" accept=".json,application/json" onChange={event => void choose(event)} />
        </label>
        {file ? <span className="muted file-name">{file.name}</span> : null}
      </div>
      {run.isPending ? <p className="hint">{result ? t('settings.restoring') : t('settings.checkingFile')}</p> : null}
      {result ? (
        <div className="import-summary" aria-live="polite">
          <ul className="import-stats">
            <li>
              {t(result.dry_run ? 'settings.entriesToAdd' : 'settings.entriesAdded', { count: result.time_entries })}
            </li>
            <li>{t('settings.alreadyHere', { count: result.skipped_duplicates })}</li>
            <li>
              {t(result.dry_run ? 'settings.othersToAdd' : 'settings.othersAdded', {
                projects: t('settings.projectCount', { count: result.projects }),
                clients: t('settings.clientCount', { count: result.clients }),
                tasks: t('settings.taskCount', { count: result.tasks }),
                tags: t('settings.tagCount', { count: result.tags }),
              })}
            </li>
            {result.errors.length ? (
              <li className="is-error">{t('settings.problemCount', { count: result.errors.length })}</li>
            ) : null}
          </ul>
          {result.errors.length ? (
            <details className="import-errors">
              <summary>{t('settings.problems')}</summary>
              <ul>
                {result.errors.map((error, i) => (
                  <li key={i}>
                    {t('settings.restoreError', {
                      entity: error.entity,
                      id: restoreErrorId(error.id),
                      message: error.message,
                    })}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {file && result?.dry_run ? (
        <div className="inline-controls settings-row">
          <button
            type="button"
            className="button button-primary"
            disabled={run.isPending}
            onClick={() => run.mutate({ text: file.text, dryRun: false })}
          >
            <Icon name="upload" size={16} /> {t('settings.restore')}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              setFile(null);
              setResult(null);
              if (input.current) input.current.value = '';
            }}
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
    </>
  );
}
