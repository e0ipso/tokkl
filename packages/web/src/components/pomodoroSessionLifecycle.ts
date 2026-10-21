/** The signed-in provider registers here so both sign-out buttons use the same ordered cleanup. */
interface ActiveSession {
  finish: () => Promise<void>;
  forget: () => void;
}

let active: ActiveSession | null = null;

export function registerPomodoroSession(session: ActiveSession): () => void {
  active = session;
  return () => { if (active === session) active = null; };
}

/** A failed final save is lost on sign-out; it must not prevent the logout request. */
export async function finishPomodoroSession(): Promise<void> {
  try {
    await active?.finish();
  } catch {
    // The provider reports the save failure. Signing out still discards the session.
  }
}

export function forgetActivePomodoroSession(): void {
  active?.forget();
  active = null;
}
