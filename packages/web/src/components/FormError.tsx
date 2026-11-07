import { FieldError } from './FieldError.tsx';
import { Icon } from './Icon.tsx';

/**
 * An error about a whole sign-in form, such as a refused login: a warning icon and the message as
 * an alert. Renders nothing without a message.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="auth-error">
      <Icon name="alert" className="error-icon" />
      <FieldError message={message} />
    </div>
  );
}

/** The message of a failed request, for showing it to the user. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
