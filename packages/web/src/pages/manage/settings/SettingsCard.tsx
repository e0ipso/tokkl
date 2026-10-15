import type { FormEvent, ReactNode } from 'react';

/** One settings section: a card with a title, an optional intro line and its own save button. */
export function SettingsCard({ id, title, intro, children, onSubmit, saveLabel = 'Save', saving = false, saveDisabled = false }: {
  id: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  /** Renders the card as a form with a save button when set. */
  onSubmit?: () => void;
  saveLabel?: string;
  saving?: boolean;
  saveDisabled?: boolean;
}) {
  const headingId = `${id}-title`;
  const body = (
    <>
      <div className="settings-card-head"><h2 id={headingId}>{title}</h2></div>
      {intro ? <p className="hint settings-intro">{intro}</p> : null}
      {children}
    </>
  );
  if (!onSubmit) {
    return <section className="card settings-card" id={id} aria-labelledby={headingId}>{body}</section>;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    // noValidate: sections check their own fields and show the errors inline (components/FieldError.tsx).
    <form className="card settings-card" id={id} aria-labelledby={headingId} noValidate onSubmit={submit}>
      {body}
      <div className="settings-actions">
        <button type="submit" className="button button-primary" disabled={saving || saveDisabled}>
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </form>
  );
}
