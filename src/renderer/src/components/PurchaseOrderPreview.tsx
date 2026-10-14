import { useEffect, useState } from 'react';
import { Printer, FileText, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { call } from '../lib/ipc';

/**
 * The order sheet as it will be sent. A shop with no printer can still save it
 * and mail it, which is how most orders reach a supplier anyway.
 */
export function PurchaseOrderPreview({
  orderId,
  orderNumber,
  onClose,
}: {
  orderId: string;
  orderNumber: string | null;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void call('purchaseOrders:document', { id: orderId })
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
  }, [orderId]);

  async function print() {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await call('purchaseOrders:print', { id: orderId, printerName: null });
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
      const result = await call('purchaseOrders:exportPdf', { id: orderId });
      if (result.saved) setMessage({ kind: 'ok', text: 'PDF saved.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal preview-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{orderNumber ? `Order ${orderNumber}` : 'Purchase order'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="preview-bar">
          <span className="field-hint">A4 sheet</span>

          <div className="page-actions">
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
            <iframe title="Order preview" className="preview-frame a4" srcDoc={html} sandbox="" />
          ) : (
            <p className="empty">Rendering…</p>
          )}
        </div>

        <footer className="modal-foot preview-foot">
          <span className="field-hint">
            An order is not a bill. Nothing is owed until the goods and their bill arrive.
          </span>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
