import type { FormEvent, ReactNode, Ref } from 'react';

/** One settings section: a card with a title, an optional intro line and its own save button. */
export function SettingsCard({ id, title, titleRef, intro, children, onSubmit, saveLabel = 'Save', saving = false, saveDisabled = false }: {
  id: string;
  title: string;
  /** Lets the section move focus to its title, for example when the focused row went away. */
  titleRef?: Ref<HTMLHeadingElement>;
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
      <div className="settings-card-head">
        <h2 id={headingId} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>{title}</h2>
      </div>
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
