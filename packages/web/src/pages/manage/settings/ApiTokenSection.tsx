import { useState } from 'react';
import { accountRequests } from '../../../api/account.ts';
import { stale } from '../../../api/keys.ts';
import type { Me } from '../../../api/types.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { copyText } from '../../../lib/clipboard.ts';
import { ConfirmModal } from '../ui.tsx';
import { useAction } from '../../../components/useAction.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { t } from '../../../i18n/messages.ts';
import { tx } from '../../../i18n/rich.ts';

export function ApiTokenSection({ me }: { me: Me }) {
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const origin = window.location.origin;

  const reset = useAction<void, string>({
    mutationFn: accountRequests.resetApiToken,
    invalidate: stale.credentials,
    success: t('settings.tokenReset'),
    onSuccess: () => {
      setConfirmReset(false);
      setRevealed(true);
    },
  });

  const copy = () => {
    copyText(me.api_token, t('settings.tokenCopyFailed')).then(
      () => toast.show(t('settings.tokenCopied')),
      (error: unknown) => toast.error(error),
    );
  };

  return (
    <SettingsCard id="api-token" title={t('settings.token')} intro={t('settings.tokenIntro')}>
      <div className="token-row">
        <code className="token-value" aria-label={revealed ? t('settings.token') : t('settings.tokenHidden')}>
          {revealed ? me.api_token : '•'.repeat(32)}
        </code>
        <button type="button" className="button button-ghost" onClick={() => setRevealed(!revealed)}>
          {revealed ? t('settings.hide') : t('settings.show')}
        </button>
        <button type="button" className="button button-ghost" onClick={copy}>
          <Icon name="copy" size={16} /> {t('settings.copy')}
        </button>
        <span className="spacer" />
        <button type="button" className="button button-danger-ghost" onClick={() => setConfirmReset(true)}>
          {t('settings.resetToken')}
        </button>
      </div>

      <h3 className="settings-subheading">{t('settings.tryIt')}</h3>
      <pre className="code-block">
        <code>{`curl -u <token>:api_token ${origin}/api/v9/me`}</code>
      </pre>
      <p className="hint">
        {tx('settings.apiBase', {
          api: <code>{origin}/api/v9</code>,
          reports: <code>{origin}/reports/api/v3</code>,
        })}
      </p>

      {confirmReset ? (
        <ConfirmModal
          title={t('settings.resetTokenTitle')}
          confirmLabel={t('settings.resetToken')}
          busy={reset.isPending}
          onConfirm={() => reset.mutate()}
          onClose={() => setConfirmReset(false)}
        >
          <p>{t('settings.resetTokenBody')}</p>
        </ConfirmModal>
      ) : null}
    </SettingsCard>
  );
}
