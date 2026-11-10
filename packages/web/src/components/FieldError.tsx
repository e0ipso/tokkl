import { useId, useRef, useState } from 'react';

/**
 * A failing field gets aria-invalid and aria-describedby to a .field-error alert; typing clears it.
 * Errors that belong to no field stay toasts.
 */

/** Under a field, or under a form for an error about the whole form. */
export function FieldError({ id, message }: { id?: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error" role="alert">
      {message}
    </p>
  );
}

/** A falsy message means valid. */
export type FieldCheck<K extends string> = readonly [field: K, message: string | null | false | undefined];

export function useFieldErrors<K extends string>() {
  const baseId = useId();
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const elements = useRef(new Map<K, HTMLElement>());
  const refs = useRef(new Map<K, (element: HTMLElement | null) => void>());
  const inputId = (key: K) => `${baseId}-${key}`;
  const errorId = (key: K) => `${baseId}-${key}-error`;

  const clear = (key: K) =>
    setErrors(current => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });

  /** Shows failing fields' messages, clears passing ones, focuses the first failure; unlisted fields keep theirs. */
  const validate = (checks: ReadonlyArray<FieldCheck<K>>): boolean => {
    setErrors(current => {
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
      ref = element => {
        if (element) elements.current.set(key, element);
        else elements.current.delete(key);
      };
      refs.current.set(key, ref);
    }
    return ref;
  };

  /** Its label points at it with htmlFor={id(key)}. */
  const field = (key: K) => ({
    id: inputId(key),
    ref: refFor(key),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? errorId(key) : undefined,
    onInput: () => clear(key),
  });

  const message = (key: K) => <FieldError id={errorId(key)} message={errors[key]} />;

  return { validate, field, message, clear, id: inputId };
}
