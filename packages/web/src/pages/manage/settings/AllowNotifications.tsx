import { useEffect, useId, useRef, useState } from 'react';
import { notificationAccess, requestNotificationAccess, type NotificationAccess } from '../../../components/phaseNotification.ts';

const STATUS: Record<NotificationAccess, string> = {
  default: 'Shows a notification when a phase ends while Tokkl is in a background tab.',
  granted: 'Notifications are allowed. Tokkl shows one when a phase ends while it is in a background tab.',
  denied: "Notifications are blocked. Allow them in the browser's site settings to get one when a phase ends in a background tab.",
  insecure: 'Notifications need HTTPS. Open Tokkl over HTTPS to get one when a phase ends in a background tab.',
  unsupported: "This browser can't show notifications.",
};

/**
 * The Pomodoro's Allow notifications button and a line saying what the browser allows. Only the
 * button's click asks for permission. The button goes once the browser answers, and focus moves to
 * the line that replaced it.
 */
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
          <button type="button" className="button button-ghost" aria-describedby={statusId} onClick={() => void allow()}>
            Allow notifications
          </button>
        </div>
      ) : null}
      <p ref={status} id={statusId} className="hint" tabIndex={-1}>{STATUS[access]}</p>
    </div>
  );
}
