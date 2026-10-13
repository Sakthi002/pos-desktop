import { useEffect, useRef, useState } from 'react';
import { Lock, LogIn } from 'lucide-react';
import { call } from '../lib/ipc';
import { Field } from '../components/Field';
import type { SessionState } from '@shared/auth';
import type { AppSettings } from '@shared/settings';

/**
 * The door. It is also the lock screen: when the till has locked itself the
 * username is already known, so only the password is asked for and the shop
 * name stays on screen — a cashier coming back from the back room should see
 * the same till, not a strange one.
 */
export function Login({
  state,
  settings,
  onSignedIn,
}: {
  state: SessionState;
  settings: AppSettings | null;
  onSignedIn: (next: SessionState) => void;
}) {
  const relocking = state.locked && state.lastUsername !== null;
  const [username, setUsername] = useState(relocking ? state.lastUsername! : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (relocking ? passwordRef : usernameRef).current?.focus();
  }, [relocking]);

  async function submit() {
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await call('auth:login', { username: username.trim(), password }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword('');
      passwordRef.current?.focus();
      setBusy(false);
    }
  }

  return (
    <div className="boot">
      <div className="panel login-panel">
        <h1>
          {relocking ? <Lock size={18} /> : <LogIn size={18} />}
          {relocking ? 'Locked' : 'Sign in'}
        </h1>
        <p className="sub">
          {settings?.shop.name ?? 'Universal POS'}
          {relocking ? ' — your password reopens it' : ''}
        </p>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Username" htmlFor="login-user" required>
            <input
              id="login-user"
              ref={usernameRef}
              value={username}
              autoComplete="off"
              readOnly={relocking}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="login-pass" required>
            <input
              id="login-pass"
              ref={passwordRef}
              type="password"
              value={password}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <button className="btn-primary wide" type="submit" disabled={busy}>
            {busy ? 'Checking…' : relocking ? 'Unlock' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Shown when an administrator has set a password for somebody: it is used once,
 * to choose their own. Nothing else in the app works until it is done.
 */
export function ForcedPasswordChange({ onDone }: { onDone: (next: SessionState) => void }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (newPassword !== confirm) {
      setError('The two new passwords are different.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await call('auth:changePassword', { currentPassword, newPassword }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="boot">
      <div className="panel login-panel">
        <h1>
          <Lock size={18} /> Choose your password
        </h1>
        <p className="sub">
          The password you were given was set by somebody else. Choose one only you know.
        </p>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="The password you were given" htmlFor="cp-current" required>
            <input
              id="cp-current"
              type="password"
              value={currentPassword}
              autoComplete="off"
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="New password" htmlFor="cp-new" hint="At least 6 characters" required>
            <input
              id="cp-new"
              type="password"
              value={newPassword}
              autoComplete="off"
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="New password again" htmlFor="cp-confirm" required>
            <input
              id="cp-confirm"
              type="password"
              value={confirm}
              autoComplete="off"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>

          <button className="btn-primary wide" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set my password'}
          </button>
        </form>
      </div>
    </div>
  );
}
