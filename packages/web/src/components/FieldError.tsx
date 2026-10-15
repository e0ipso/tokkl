import { useId, useRef, useState } from 'react';

/**
 * Inline validation errors for form fields.
 *
 * A field with an error gets aria-invalid, which the CSS turns into a --danger border, and
 * aria-describedby pointing at a .field-error message (role=alert) rendered under it. Typing in the
 * field clears its error. Errors that belong to no field, such as a failed request, stay toasts.
 */

/** The message under a field, or under a form for an error about the whole form. */
export function FieldError({ id, message }: { id?: string; message: string | null | undefined }) {
  if (!message) return null;
  return <p id={id} className="field-error" role="alert">{message}</p>;
}

/** A field and the message to show for it, or a falsy value when it is valid. */
export type FieldCheck<K extends string> = readonly [field: K, message: string | null | false | undefined];

export function useFieldErrors<K extends string>() {
  const baseId = useId();
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const elements = useRef(new Map<K, HTMLElement>());
  const refs = useRef(new Map<K, (element: HTMLElement | null) => void>());
  const inputId = (key: K) => `${baseId}-${key}`;
  const errorId = (key: K) => `${baseId}-${key}-error`;

  const clear = (key: K) => setErrors((current) => {
    if (!(key in current)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  });

  /**
   * Runs the checks in field order: shows the message of every failing field, clears the ones that
   * pass, and moves focus to the first failing field. Fields not listed keep their errors.
   * Returns true when every check passed.
   */
  const validate = (checks: ReadonlyArray<FieldCheck<K>>): boolean => {
    setErrors((current) => {
      const next = { ...current };
      for (const [key, message] of checks) {
        if (message) next[key] = message;
        else delete next[key];
      }
      return next;
    });
    const first = checks.find(([, message]) => message);
    if (first) elements.current.get(first[0])?.focus();
    return first === undefined;
  };

  const refFor = (key: K) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (element) => {
        if (element) elements.current.set(key, element);
        else elements.current.delete(key);
      };
      refs.current.set(key, ref);
    }
    return ref;
  };

  /** Props for the field's input. Its label points at it with htmlFor={id(key)}. */
  const field = (key: K) => ({
    id: inputId(key),
    ref: refFor(key),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? errorId(key) : undefined,
    onInput: () => clear(key),
  });

  /** The field's message, rendered where it should appear. */
  const message = (key: K) => <FieldError id={errorId(key)} message={errors[key]} />;

  return { validate, field, message, clear, id: inputId };
}
