import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import type { PartyStatement } from '@shared/ledger';

const ALL_TIME = {
  fromIso: '2000-01-01T00:00:00.000Z',
  toIso: '2100-01-01T00:00:00.000Z',
};

const VOUCHER_LABEL: Record<string, string> = {
  sale: 'Invoice',
  sale_return: 'Credit note',
  sale_void: 'Voided',
  purchase: 'Purchase bill',
  purchase_return: 'Debit note',
  purchase_cancel: 'Cancelled',
  receipt: 'Received',
  payment: 'Paid',
  journal: 'Journal',
  opening: 'Opening',
};

/**
 * One party's account, read out of the control account in the books rather
 * than recomputed from documents — so what a supplier is shown here and what
 * the trial balance says can never drift apart.
 */
export function PartyLedgerDialog({
  partyType,
  partyId,
  name,
  onClose,
}: {
  partyType: 'customer' | 'supplier';
  partyId: string;
  name: string;
  onClose: () => void;
}) {
  const [statement, setStatement] = useState<PartyStatement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call('ledger:partyStatement', { partyType, partyId, ...ALL_TIME, limit: 500 })
      .then((result) => {
        if (!cancelled) setStatement(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [partyType, partyId]);

  const owes = partyType === 'customer' ? 'Owes us' : 'We owe';

  return (
    <Modal title={`${name} — account`} onClose={onClose} width={720}>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {statement && statement.lines.length === 0 && (
        <p className="field-hint">Nothing on this account yet.</p>
      )}

      {statement && statement.lines.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Document</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <tr key={line.id}>
                  <td>{new Date(line.entryDate).toLocaleDateString()}</td>
                  <td>
                    <strong>{VOUCHER_LABEL[line.voucherType] ?? line.voucherType}</strong>
                    <span className="sub-cell">{line.narration ?? line.voucherNo}</span>
                  </td>
                  <td className="num">{line.debitPaise ? formatPaise(line.debitPaise) : '—'}</td>
                  <td className="num">{line.creditPaise ? formatPaise(line.creditPaise) : '—'}</td>
                  <td className="num">{formatPaise(line.balancePaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{owes} now</td>
                <td className="num">{formatPaise(statement.closingPaise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}
