import { useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, MessageCircle, Send } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { formatPaise } from '@shared/money';
import type { WhatsappDraft, WhatsappSend } from '@shared/ipc-contract';

const TITLES: Record<WhatsappDraft['kind'], string> = {
  sale: 'Send the bill on WhatsApp',
  quotation: 'Send the quotation on WhatsApp',
  purchaseOrder: 'Send the order on WhatsApp',
  statement: 'Send the account on WhatsApp',
};

/**
 * Sending a document to the person it concerns.
 *
 * The number and the message are both the shop's to change before anything
 * leaves: a customer's number may be wrong on file, and no two shops write the
 * same message. What is attached is not editable — it is the document as it
 * stands, built where the prices live.
 */
export function WhatsAppDialog({
  kind,
  id,
  onClose,
}: {
  kind: WhatsappDraft['kind'];
  id: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<WhatsappDraft | null>(null);
  const [number, setNumber] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState<WhatsappSend | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call('whatsapp:draft', { kind, id })
      .then((next) => {
        if (cancelled) return;
        setDraft(next);
        setNumber(next.number ?? next.rawNumber ?? '');
        setMessage(next.message);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      setSent(await call('whatsapp:send', { kind, id, number: number.trim(), message }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function showPdf() {
    if (!sent) return;
    try {
      await call('whatsapp:reveal', { path: sent.pdfPath });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal
      title={TITLES[kind]}
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="field-hint">
            {sent
              ? 'WhatsApp is open, and the PDF is waiting in a window beside it.'
              : 'Nothing is sent from here — WhatsApp opens with the message ready.'}
          </span>
          <div className="page-actions">
            {sent && (
              <button className="btn-secondary" onClick={() => void showPdf()}>
                <FolderOpen size={15} /> Show the PDF
              </button>
            )}
            <button
              className="btn-success"
              onClick={() => void send()}
              disabled={busy || !draft || number.trim() === '' || message.trim() === ''}
            >
              <Send size={15} /> {busy ? 'Preparing…' : sent ? 'Open again' : 'Open WhatsApp'}
            </button>
          </div>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {draft && (
        <>
          <div className="dash-row" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat-text">
                <span className="stat-label">{kind === 'statement' ? 'Account' : 'Document'}</span>
                <strong className="stat-value">{draft.documentNumber}</strong>
                {draft.toName && kind !== 'statement' && (
                  <span className="stat-note">For {draft.toName}</span>
                )}
              </div>
            </div>
            <div className="stat">
              <div className="stat-text">
                <span className="stat-label">
                  {kind === 'statement'
                    ? 'Outstanding'
                    : kind === 'purchaseOrder'
                      ? 'Order value'
                      : 'Total'}
                </span>
                <strong className="stat-value">{formatPaise(draft.amountPaise)}</strong>
              </div>
            </div>
          </div>

          <Field
            label="WhatsApp number"
            htmlFor="wa-number"
            required
            error={draft.numberProblem && number.trim() === '' ? draft.numberProblem : undefined}
            hint="With the country code. 10 digits are taken as Indian."
          >
            <input
              id="wa-number"
              inputMode="tel"
              placeholder="919876543210"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>

          <Field label="Message" htmlFor="wa-message" plainLabel>
            <textarea
              id="wa-message"
              rows={7}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>

          <p className="field-hint" style={{ marginTop: -4 }}>
            <MessageCircle size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            WhatsApp opens with this message typed, and the A4 sheet is saved beside it.{' '}
            <strong>Drag the PDF</strong> from the window that opens into the chat to send it as a
            file — or press Ctrl+V to paste it as a picture instead.
          </p>

          {sent && (
            <div className="preview-note" style={{ marginTop: 12 }}>
              <p className="preview-ok" role="status">
                <CheckCircle2 size={14} />
                {sent.revealed
                  ? 'The PDF is selected in a window — drag it into the chat. Both files are in '
                  : 'Both files are in '}
                {sent.folder}
              </p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
