import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { ApprovalFields } from './ApprovalFields';
import { EMPTY_APPROVAL, needsApproval, type Approval } from '../lib/approval';
import { formatPaise } from '@shared/money';
import type { SaleSummary } from '@shared/sale';

/**
 * Voiding is the only way to undo a sale, and it is not a delete: the invoice
 * keeps its number and stays in history. The reason is mandatory because the
 * audit entry is worthless without it.
 */
export function VoidSaleDialog({
  sale,
  onClose,
  onVoided,
}: {
  sale: Pick<SaleSummary, 'id' | 'invoiceNumber' | 'totalPaise'>;
  onClose: () => void;
  onVoided: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);

  async function confirm() {
    if (reason.trim().length < 3) {
      setError('Give a reason for the void.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('sales:void', {
        id: sale.id,
        reason: reason.trim(),
        ...(approval?.username ? { approval } : {}),
      });
      onVoided();
    } catch (err) {
      // The first refusal is the shop's rule, not a mistake: show the fields
      // rather than an error, and keep what was already typed.
      if (needsApproval(err) && approval === null) {
        setApproval(EMPTY_APPROVAL);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Void ${sale.invoiceNumber}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Voiding…' : 'Void sale'}
          </button>
        </>
      }
    >
      <p className="warn-note">
        <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        {formatPaise(sale.totalPaise)} comes off the day&apos;s takings and the items go back into
        stock. The invoice stays in history, marked voided — it is never deleted.
      </p>

      {approval && <ApprovalFields value={approval} onChange={setApproval} />}

      <Field label="Reason" htmlFor="void-reason" required error={error ?? undefined}>
        <textarea
          id="void-reason"
          rows={3}
          value={reason}
          autoFocus
          maxLength={200}
          placeholder="Billed twice, customer cancelled, wrong item…"
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
