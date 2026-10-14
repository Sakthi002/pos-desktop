import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';

/**
 * Confirmation for an action that is hard to undo.
 *
 * A dialog of its own rather than a panel folded into the one behind it: an
 * action that cannot be taken back should interrupt, not appear in the margin
 * of what the shop was already reading.
 *
 * Some of them need a reason — a cancelled quotation says why it was cancelled
 * for as long as it is kept — so the dialog can ask for one and hands it to
 * the caller.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  busy = false,
  reasonLabel,
  reasonPlaceholder,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /** Asks for a reason, and refuses to confirm without one. */
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const asksReason = reasonLabel !== undefined;
  const ready = !asksReason || reason.trim().length >= 3;

  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={460}
      tone={destructive ? 'danger' : undefined}
      footer={
        <>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>
            Keep it
          </button>
          <button
            className={destructive ? 'btn-danger' : 'btn-primary'}
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || !ready}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-message">
        {destructive && <AlertTriangle size={18} />}
        <span>{message}</span>
      </p>

      {asksReason && (
        <Field label={reasonLabel} htmlFor="confirm-reason" required>
          <input
            id="confirm-reason"
            autoFocus
            value={reason}
            placeholder={reasonPlaceholder}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      )}
    </Modal>
  );
}
