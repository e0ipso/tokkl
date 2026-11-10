import { useEffect, useId, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n/messages.ts';
import { notificationAccess, requestNotificationAccess, type NotificationAccess } from './phaseNotification.ts';

const STATUS: Record<NotificationAccess, MessageKey> = {
  default: 'timer.notificationsDefault',
  granted: 'timer.notificationsGranted',
  denied: 'timer.notificationsDenied',
  insecure: 'timer.notificationsInsecure',
  unsupported: 'timer.notificationsUnsupported',
};

/** Only the button's click asks for permission. The button goes once the browser answers; focus moves to the line. */
export function AllowNotifications() {
  const [access, setAccess] = useState<NotificationAccess>(notificationAccess);
  const statusId = useId();
  const status = useRef<HTMLParagraphElement>(null);
  const answered = useRef(false);

  useEffect(() => {
    if (!answered.current) return;
    answered.current = false;
    status.current?.focus();
  }, [access]);

  const allow = async () => {
    const next = await requestNotificationAccess();
    answered.current = next !== 'default';
    setAccess(next);
  };

  return (
    <div className="field field-full">
      {access === 'default' ? (
        <div className="inline-controls">
          <button
            type="button"
            className="button button-ghost"
            aria-describedby={statusId}
            onClick={() => void allow()}
          >
            {t('timer.allowNotifications')}
          </button>
        </div>
      ) : null}
      <p ref={status} id={statusId} className="hint" tabIndex={-1}>
        {t(STATUS[access])}
      </p>
    </div>
  );
}
