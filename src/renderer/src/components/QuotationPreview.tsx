import { useEffect, useState } from 'react';
import { Printer, FileText, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { WhatsAppIcon } from './WhatsAppIcon';
import { call } from '../lib/ipc';
import { WhatsAppDialog } from './WhatsAppDialog';

/**
 * The quotation sheet as it will come out, shown before anything is sent to a
 * printer. A shop without a printer — or with one that is switched off — can
 * still read the sheet here and save it as a PDF to send to the customer.
 */
export function QuotationPreview({
  quotationId,
  quotationNumber,
  onClose,
}: {
  quotationId: string;
  quotationNumber: string | null;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // The sheet is built in the main process, so the renderer never assembles
    // prices and the preview cannot differ from what is printed.
    let cancelled = false;
    void call('quotations:document', { id: quotationId })
      .then((doc) => {
        if (cancelled) return;
        setHtml(doc.html);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [quotationId]);

  async function print() {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await call('quotations:print', { id: quotationId, printerName: null });
      setMessage(
        outcome.printed
          ? { kind: 'ok', text: 'Sent to the printer.' }
          : { kind: 'warn', text: outcome.reason ?? 'Not printed.' },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePdf() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await call('quotations:exportPdf', { id: quotationId });
      if (result.saved) setMessage({ kind: 'ok', text: 'PDF saved.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="modal-backdrop" onMouseDown={onClose}>
        <div className="modal preview-modal" onMouseDown={(e) => e.stopPropagation()}>
          <header className="modal-head">
            <h2>{quotationNumber ? `Quotation ${quotationNumber}` : 'Quotation'}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </header>

          <div className="preview-bar">
            <span className="field-hint">A4 sheet</span>

            <div className="page-actions">
              <button
                className="btn-whatsapp"
                onClick={() => setSending(true)}
                disabled={busy || !html}
              >
                <WhatsAppIcon /> WhatsApp
              </button>
              <button className="btn-info" onClick={() => void savePdf()} disabled={busy || !html}>
                <FileText size={15} /> Save PDF
              </button>
              <button className="btn-primary" onClick={() => void print()} disabled={busy || !html}>
                <Printer size={15} /> Print
              </button>
            </div>
          </div>

          {error && (
            <p className="field-error" role="alert" style={{ padding: '0 20px' }}>
              {error}
            </p>
          )}

          {message && (
            <div className="preview-note">
              <p className={message.kind === 'ok' ? 'preview-ok' : 'preview-warn'} role="status">
                {message.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {message.text}
              </p>
            </div>
          )}

          <div className="preview-stage">
            {html ? (
              <iframe
                title="Quotation preview"
                className="preview-frame a4"
                srcDoc={html}
                sandbox=""
              />
            ) : (
              <p className="empty">Rendering…</p>
            )}
          </div>

          <footer className="modal-foot preview-foot">
            <span className="field-hint">
              A quotation is not a bill. Nothing is sold and no stock moves until it is billed.
            </span>
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </footer>
        </div>
      </div>

      {/* Outside the preview's own backdrop: a click to dismiss this dialog
          must not also dismiss the sheet behind it. */}
      {sending && (
        <WhatsAppDialog kind="quotation" id={quotationId} onClose={() => setSending(false)} />
      )}
    </>
  );
}
