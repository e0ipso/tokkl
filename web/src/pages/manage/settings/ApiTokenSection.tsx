import { useState } from 'react';
import { api } from '../../../api/client.ts';
import { keys } from '../../../api/hooks.ts';
import type { Me } from '../../../api/types.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { ConfirmModal } from '../ui.tsx';
import { useAction, V9 } from '../queries.ts';
import { SettingsCard } from './SettingsCard.tsx';

/** Copies through a hidden textarea; returns whether the browser reports success. */
function copyWithTextarea(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/**
 * Copies text to the clipboard. `navigator.clipboard` only exists on HTTPS or localhost, and a
 * self-hosted server is often reached over plain HTTP on the LAN. The browser can also refuse the
 * Clipboard API, for example when the user blocked clipboard access. Both cases fall back to a
 * hidden textarea, and a failure there tells the user to copy by hand.
 */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Refused; try the textarea below.
    }
  }
  if (!copyWithTextarea(text)) throw new Error('Could not copy. Show the token and copy it by hand.');
}

export function ApiTokenSection({ me }: { me: Me }) {
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const origin = window.location.origin;

  const reset = useAction<void, string>({
    mutationFn: () => api.post<string>(`${V9}/me/reset_token`),
    invalidate: [keys.me],
    success: 'New API token created. Update the tools that use it.',
    onSuccess: () => {
      setConfirmReset(false);
      setRevealed(true);
    },
  });

  const copy = () => {
    copyText(me.api_token).then(() => toast.show('API token copied'), (error: unknown) => toast.error(error));
  };

  return (
    <SettingsCard
      id="api-token"
      title="API token"
      intro="Tools that speak the Toggl Track API use this token to read and write your data. Treat it like a password."
    >
      <div className="token-row">
        <code className="token-value" aria-label={revealed ? 'API token' : 'API token, hidden'}>
          {revealed ? me.api_token : '•'.repeat(32)}
        </code>
        <button type="button" className="button button-ghost" onClick={() => setRevealed(!revealed)}>
          {revealed ? 'Hide' : 'Show'}
        </button>
        <button type="button" className="button button-ghost" onClick={copy}>
          <Icon name="copy" size={16} /> Copy
        </button>
        <span className="spacer" />
        <button type="button" className="button button-danger-ghost" onClick={() => setConfirmReset(true)}>
          Reset token
        </button>
      </div>

      <h3 className="settings-subheading">Try it</h3>
      <pre className="code-block"><code>{`curl -u <token>:api_token ${origin}/api/v9/me`}</code></pre>
      <p className="hint">
        Any tool that lets you change the Toggl base URL can use this server. Point it at <code>{origin}/api/v9</code>,
        and the reports API at <code>{origin}/reports/api/v3</code>.
      </p>

      {confirmReset ? (
        <ConfirmModal
          title="Reset the API token?"
          confirmLabel="Reset token"
          busy={reset.isPending}
          onConfirm={() => reset.mutate()}
          onClose={() => setConfirmReset(false)}
        >
          <p>The current token stops working right away. Every tool or script that uses it fails until you give it the new one.</p>
        </ConfirmModal>
      ) : null}
    </SettingsCard>
  );
}
