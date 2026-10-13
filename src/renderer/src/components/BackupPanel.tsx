import { useCallback, useEffect, useState } from 'react';
import {
  FolderOpen,
  HardDriveDownload,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { call } from '../lib/ipc';
import { Field } from './Field';
import { Modal } from './Modal';
import type { AppSettings } from '@shared/settings';
import type { BackupFile, BackupInspection } from '@shared/backup';

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Backup and restore.
 *
 * These are actions rather than edits, so this panel saves its own settings as
 * they change instead of waiting for the page's Save button — a shop that picks
 * a folder and presses "Back up now" should not be told the folder is not set.
 */
export function BackupPanel({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: (next: AppSettings) => void;
}) {
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupInspection | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const { backup } = settings;

  const refresh = useCallback(async () => {
    try {
      setFiles(await call('backup:list'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async IPC load
    void refresh();
  }, [refresh, backup.directory]);

  async function save(patch: Partial<AppSettings['backup']>) {
    setError(null);
    try {
      onSaved(await call('settings:update', { backup: patch }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function chooseFolder() {
    const picked = await call('dialog:pickBackupDirectory');
    if (picked.path) await save({ directory: picked.path });
  }

  async function backupNow() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await call('backup:run', { trigger: 'manual' });
      setMessage(
        `Backed up to ${result.file.fileName}` +
          (result.pruned.length > 0 ? `, ${result.pruned.length} older removed` : '') +
          '.',
      );
      await refresh();
      onSaved(await call('settings:get').then((s) => s as AppSettings));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function chooseRestore(path?: string) {
    setError(null);
    setMessage(null);
    try {
      const target = path ?? (await call('dialog:pickBackupFile')).path;
      if (!target) return;
      setRestoring(await call('backup:inspect', { path: target }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmRestore() {
    if (!restoring) return;
    setRestoreBusy(true);
    try {
      const result = await call('backup:restore', { path: restoring.path, confirmed: true });
      setRestoring(null);
      setMessage(
        `Restored from ${result.restoredFrom}. The database as it was is saved at ${result.safetyCopyPath}.`,
      );
      // Everything on screen came from the old database.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRestoreBusy(false);
    }
  }

  return (
    <>
      <p className="warn-note">
        <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />A backup on the
        same computer does not protect you against losing the computer. Copy backups to a pen drive
        or another machine regularly.
      </p>

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

      <Field
        label="Backup folder"
        plainLabel
        hint="Choose a folder outside the app's own data — ideally another drive."
      >
        <div className="logo-row">
          <input value={backup.directory ?? ''} readOnly placeholder="No folder chosen" />
          <button className="btn-secondary" onClick={() => void chooseFolder()}>
            <FolderOpen size={15} /> Choose
          </button>
        </div>
      </Field>

      <div className="page-actions" style={{ margin: '4px 0 18px' }}>
        <button
          className="btn-primary"
          onClick={() => void backupNow()}
          disabled={busy || !backup.directory}
        >
          <HardDriveDownload size={15} /> {busy ? 'Backing up…' : 'Back up now'}
        </button>
        <button className="btn-secondary" onClick={() => void chooseRestore()}>
          <RotateCcw size={15} /> Restore from a file…
        </button>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={backup.autoEnabled}
          disabled={!backup.directory}
          onChange={(e) => void save({ autoEnabled: e.target.checked })}
        />
        <span>Back up automatically</span>
      </label>

      <div className="row" style={{ marginTop: 12 }}>
        <Field label="How often" plainLabel>
          <select
            value={backup.frequency}
            onChange={(e) => void save({ frequency: e.target.value as 'daily' | 'weekly' })}
          >
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </select>
        </Field>
        <Field
          label="Backups to keep"
          plainLabel
          hint="Older ones are removed after a successful backup."
        >
          <input
            type="number"
            min={1}
            max={100}
            value={backup.keepCount}
            onChange={(e) => void save({ keepCount: Number(e.target.value) || 1 })}
          />
        </Field>
      </div>

      <p className="field-hint">
        {backup.lastRunAt
          ? `Last backup: ${formatDateTime(backup.lastRunAt)}.`
          : 'No backup has run yet.'}
      </p>

      <h3 style={{ margin: '22px 0 8px', fontSize: 14 }}>Backups in this folder</h3>
      {files.length === 0 ? (
        <p className="empty">None yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>File</th>
                <th>Taken</th>
                <th>Size</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.path}>
                  <td className="mono">{file.fileName}</td>
                  <td>{formatDateTime(file.createdAt)}</td>
                  <td>{formatSize(file.sizeBytes)}</td>
                  <td>{file.trigger === 'scheduled' ? 'Automatic' : 'Manual'}</td>
                  <td className="actions">
                    <button
                      className="btn-secondary small"
                      onClick={() => void chooseRestore(file.path)}
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restoring && (
        <Modal
          title="Restore from backup"
          onClose={() => setRestoring(null)}
          width={520}
          footer={
            <>
              <button
                className="btn-secondary"
                onClick={() => setRestoring(null)}
                disabled={restoreBusy}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={() => void confirmRestore()}
                disabled={restoreBusy || !restoring.valid}
              >
                {restoreBusy ? 'Restoring…' : 'Replace my data'}
              </button>
            </>
          }
        >
          {restoring.valid ? (
            <>
              <p className="warn-note">
                <ShieldAlert size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                This replaces everything in the app with the contents of the backup. Sales recorded
                since it was taken will be gone from the app — a copy of the current database is
                saved first, so nothing is destroyed on disk.
              </p>
              <dl className="facts">
                <dt>File</dt>
                <dd className="mono">{restoring.path}</dd>
                <dt>Taken</dt>
                <dd>{restoring.createdAt ? formatDateTime(restoring.createdAt) : 'Unknown'}</dd>
                <dt>Invoices inside</dt>
                <dd>{restoring.sales ?? '—'}</dd>
                <dt>App version</dt>
                <dd>{restoring.appVersion ?? 'Unknown'}</dd>
              </dl>
            </>
          ) : (
            <p className="field-error">{restoring.reason}</p>
          )}
        </Modal>
      )}
    </>
  );
}
