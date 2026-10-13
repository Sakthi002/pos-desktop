/**
 * Who is signed in, held in the main process.
 *
 * Not in the renderer, because a value the renderer owns is a value a renderer
 * bug can change. Not in the database, because a session is not a fact about
 * the shop — it ends when the window closes, and a crash should never leave a
 * till signed in.
 *
 * It lives in its own small module so that anything needing to know the
 * operator — a service writing a document, the IPC gate — can read it without
 * importing the service that manages it.
 */
import type { Session } from '@shared/auth';

let current: Session | null = null;
let lastActivityAt = 0;
let lastUsername: string | null = null;
let locked = false;

/** Minutes of no activity after which the session ends. 0 disables the timer. */
let idleMinutes = 0;

export function setIdleMinutes(minutes: number): void {
  idleMinutes = Math.max(0, minutes);
}

export function signIn(session: Session): void {
  current = session;
  lastUsername = session.username;
  lastActivityAt = Date.now();
  locked = false;
}

/** Ends the session and forgets who it was: the next person types their name. */
export function signOut(): void {
  current = null;
  locked = false;
  lastUsername = null;
}

/**
 * Stepping away rather than leaving. The session ends — nothing can be done
 * with the till — but the name stays, so coming back is one password.
 */
export function lock(): void {
  current = null;
  locked = true;
}

/**
 * Reads the session, ending it first if it has gone idle. Every caller goes
 * through here, so the timer cannot be bypassed by a channel that forgot it.
 */
export function currentSession(): Session | null {
  if (current && idleMinutes > 0 && Date.now() - lastActivityAt > idleMinutes * 60_000) {
    current = null;
    locked = true;
  }
  return current;
}

/** Called for real work only: asking whether the session is alive is not use. */
export function touch(): void {
  if (current) lastActivityAt = Date.now();
}

export function isLocked(): boolean {
  return locked;
}

export function lastSignedInUsername(): string | null {
  return lastUsername;
}

/** The operator a document should be stamped with, when one is signed in. */
export function sessionOperatorId(): string | null {
  return currentSession()?.operatorId ?? null;
}

export function updateSession(patch: Partial<Session>): void {
  if (current) current = { ...current, ...patch };
}
