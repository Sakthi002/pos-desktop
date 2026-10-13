import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Pencil, Plus, UserCheck, UserX, Users } from 'lucide-react';
import { call } from '../lib/ipc';
import { Field } from './Field';
import { Modal } from './Modal';
import { formatPaise, parseRupees } from '@shared/money';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@shared/permissions';
import type { UserSummary } from '@shared/auth';
import type { AppSettings } from '@shared/settings';

const formatWhen = (iso: string | null): string => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Who works here, and what the till asks of them.
 *
 * Login is off until somebody has a password, and this screen says so rather
 * than offering a switch that would lock the shop out of its own till.
 */
export function UsersPanel({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: (next: AppSettings) => void;
}) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserSummary | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const security = settings.security;

  const load = useCallback(async () => {
    try {
      setUsers(await call('users:list'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void load();
  }, [load]);

  const canSignIn = users.some((u) => u.isActive && u.hasPassword && u.role === 'admin');

  async function patchSecurity(patch: Partial<AppSettings['security']>) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await call('settings:update', { security: patch }));
      setMessage('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user: UserSummary) {
    setError(null);
    try {
      await call('users:setActive', { id: user.id, isActive: !user.isActive });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="preview-ok" role="status">
          <CheckCircle2 size={14} /> {message}
        </p>
      )}

      <section className="panel-card" style={{ marginBottom: 16 }}>
        <header>
          <Users size={16} />
          <h2>People</h2>
          <button
            className="btn-primary small"
            style={{ marginLeft: 'auto' }}
            onClick={() => setEditing('new')}
          >
            <Plus size={14} /> Add someone
          </button>
        </header>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Last signed in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={user.isActive ? '' : 'muted-row'}>
                  <td>
                    <strong>{user.name}</strong>
                    {!user.isActive && <span className="pill">Inactive</span>}
                    {!user.hasPassword && <span className="pill">No password</span>}
                    {user.mustChangePassword && <span className="pill">Must change</span>}
                  </td>
                  <td className="mono">{user.username}</td>
                  <td>{ROLE_LABELS[user.role]}</td>
                  <td>{formatWhen(user.lastLoginAt)}</td>
                  <td className="actions">
                    <button
                      className="icon-btn print"
                      title="Set a password"
                      onClick={() => setResetting(user)}
                    >
                      <KeyRound size={15} />
                    </button>
                    <button className="icon-btn view" title="Edit" onClick={() => setEditing(user)}>
                      <Pencil size={15} />
                    </button>
                    <button
                      className={user.isActive ? 'icon-btn danger' : 'icon-btn'}
                      title={user.isActive ? 'Deactivate' : 'Reactivate'}
                      onClick={() => void toggleActive(user)}
                    >
                      {user.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-card">
        <header>
          <h2>Signing in</h2>
        </header>
        <div style={{ padding: '16px 20px' }}>
          {!canSignIn && (
            <p className="field-hint" style={{ marginTop: 0 }}>
              Nobody can sign in yet. Give an owner account a password first — otherwise turning
              this on would lock the shop out of its own till.
            </p>
          )}

          <label className="check">
            <input
              type="checkbox"
              checked={security.requireLogin}
              disabled={busy || (!canSignIn && !security.requireLogin)}
              onChange={(e) => void patchSecurity({ requireLogin: e.target.checked })}
            />
            <span>
              Ask for a username and password
              <em>Each sale then records who rang it up.</em>
            </span>
          </label>

          {security.requireLogin && (
            <>
              <Field
                label="Lock the till after"
                htmlFor="sec-idle"
                hint="Minutes of no use. 0 never locks."
                plainLabel
              >
                <input
                  id="sec-idle"
                  type="number"
                  min={0}
                  max={240}
                  value={security.idleLockMinutes}
                  onChange={(e) =>
                    void patchSecurity({ idleLockMinutes: Number(e.target.value) || 0 })
                  }
                />
              </Field>

              <label className="check">
                <input
                  type="checkbox"
                  checked={security.approvalRequired}
                  disabled={busy}
                  onChange={(e) => void patchSecurity({ approvalRequired: e.target.checked })}
                />
                <span>
                  A manager must approve a large void or return
                  <em>Asked of a cashier only, and only above the value below.</em>
                </span>
              </label>

              {security.approvalRequired && (
                <Field
                  label="Above"
                  htmlFor="sec-threshold"
                  hint={`Currently ${formatPaise(security.approvalAbovePaise)}`}
                  plainLabel
                >
                  <input
                    id="sec-threshold"
                    className="price-input"
                    inputMode="decimal"
                    defaultValue={(security.approvalAbovePaise / 100).toFixed(2)}
                    onBlur={(e) => {
                      const paise = parseRupees(e.target.value);
                      if (paise !== null && paise !== security.approvalAbovePaise) {
                        void patchSecurity({ approvalAbovePaise: paise });
                      }
                    }}
                  />
                </Field>
              )}
            </>
          )}
        </div>
      </section>

      {editing !== null && (
        <UserForm
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setMessage('Saved.');
            void load();
          }}
        />
      )}

      {resetting && (
        <PasswordForm
          user={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => {
            setResetting(null);
            setMessage('Password set. They will be asked to choose their own.');
            void load();
          }}
        />
      )}
    </>
  );
}

function UserForm({
  user,
  onClose,
  onSaved,
}: {
  user: UserSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'cashier');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (user) {
        await call('users:update', { id: user.id, name: name.trim(), role });
      } else {
        await call('users:create', {
          name: name.trim(),
          username: username.trim(),
          role,
          password,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={user ? `Edit ${user.name}` : 'Add someone'}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <Field label="Name" htmlFor="u-name" required>
        <input id="u-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      {!user && (
        <>
          <Field
            label="Username"
            htmlFor="u-username"
            hint="What they type to sign in. It cannot be changed later."
            required
          >
            <input
              id="u-username"
              value={username}
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="u-password"
            hint="At least 6 characters. They choose their own when they first sign in."
            required
          >
            <input
              id="u-password"
              type="password"
              value={password}
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </>
      )}

      <Field label="Role" htmlFor="u-role" hint={ROLE_DESCRIPTIONS[role]} required>
        <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

function PasswordForm({
  user,
  onClose,
  onSaved,
}: {
  user: UserSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await call('users:resetPassword', { id: user.id, password });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Set a password for ${user.name}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <p className="field-hint" style={{ marginTop: 0 }}>
        Tell them this password once. The first time they sign in with it they are made to choose
        their own, so what you type here is never the password in daily use.
      </p>

      <Field label="Password" htmlFor="pw-new" hint="At least 6 characters" required>
        <input
          id="pw-new"
          type="password"
          value={password}
          autoComplete="off"
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
