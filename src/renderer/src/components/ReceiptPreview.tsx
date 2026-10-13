import { useEffect, useState } from 'react';
import { Printer, FileText, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { call } from '../lib/ipc';
import type { PaperSize } from '@shared/receipt';
import type { AppSettings } from '@shared/settings';

const SIZES: { id: PaperSize; label: string }[] = [
  { id: '58mm', label: '58 mm' },
  { id: '80mm', label: '80 mm' },
  { id: 'a4', label: 'A4' },
];

/**
 * Shows the exact document that will be printed or exported — the main process
 * builds it once and the preview renders that same HTML, so what is on screen
 * cannot differ from what comes out of the printer.
 */
export function ReceiptPreview({
  saleId,
  settings,
  isReprint = false,
  onClose,
}: {
  saleId: string;
  settings: AppSettings;
  isReprint?: boolean;
  onClose: () => void;
}) {
  const [paperSize, setPaperSize] = useState<PaperSize>(settings.receipt.paperSize);
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The document is built in the main process; state is only set once that
    // round-trip resolves, and a response arriving after the paper size changed
    // again is dropped.
    let cancelled = false;
    void call('print:previewHtml', { saleId, paperSize, isReprint })
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
  }, [saleId, paperSize, isReprint]);

  async function print() {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await call('print:receipt', {
        saleId,
        paperSize,
        printerName: settings.receipt.printerName ?? null,
        silent: settings.receipt.silentPrint ?? false,
        isReprint,
      });
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
      const result = await call('print:exportPdf', { saleId, paperSize, isReprint });
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
          <h2>Invoice preview</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="preview-bar">
          <div className="chips">
            {SIZES.map((s) => (
              <button
                key={s.id}
                className={paperSize === s.id ? 'chip on' : 'chip'}
                onClick={() => setPaperSize(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

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
          <p className={message.kind === 'ok' ? 'preview-ok' : 'preview-warn'} role="status">
            {message.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {message.text}
          </p>
        )}

        <div className="preview-stage">
          {html ? (
            <iframe
              title="Invoice preview"
              className={`preview-frame ${paperSize}`}
              srcDoc={html}
              sandbox=""
            />
          ) : (
            <p className="empty">Rendering…</p>
          )}
        </div>

        <footer className="modal-foot preview-foot">
          <span className="field-hint">
            Printing cannot change a saved sale. If it fails, reprint from here.
          </span>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
