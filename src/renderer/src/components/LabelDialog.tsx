import { useEffect, useState } from 'react';
import { Printer, Tag } from 'lucide-react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { LABEL_SHEETS, SHEET_SPECS, type LabelSheet } from '@shared/labels';
import { PRICE_LEVELS, PRICE_LEVEL_LABELS, type PriceLevel } from '@shared/trade';
import type { Product } from '@shared/catalogue';
import type { PrinterInfo } from '@shared/ipc-contract';

/**
 * Shelf labels for the products on screen.
 *
 * The preview is the sheet itself, rendered by the main process from the
 * stored products — so what prints is what the till would charge, not what the
 * list on screen happened to be showing.
 */
export function LabelDialog({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.id, 1])),
  );
  const [sheet, setSheet] = useState<LabelSheet>('a4-40');
  const [priceLevel, setPriceLevel] = useState<PriceLevel>('retail');
  const [showMrp, setShowMrp] = useState(false);
  const [skip, setSkip] = useState(0);
  const [html, setHtml] = useState('');
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const items = products
    .filter((p) => (counts[p.id] ?? 0) > 0)
    .map((p) => ({ productId: p.id, count: counts[p.id] as number }));

  useEffect(() => {
    void call('print:listPrinters')
      .then(setPrinters)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    void call('labels:preview', { items, sheet, priceLevel, showPrice: true, showMrp, skip })
      .then((result) => {
        if (!cancelled) setHtml(result.html);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // The item list is rebuilt on every render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(items), sheet, priceLevel, showMrp, skip]);

  async function print() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await call('labels:print', {
        items,
        sheet,
        priceLevel,
        showPrice: true,
        showMrp,
        skip,
        printerName: printerName || null,
      });
      setMessage(
        outcome.printed ? 'Sent to the printer.' : (outcome.reason ?? 'Nothing was printed.'),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const total = items.reduce((a, i) => a + i.count, 0);
  // Derived, so a sheet is never shown for a selection that has emptied.
  const preview = items.length === 0 ? '' : html;

  return (
    <Modal
      title="Shelf labels"
      onClose={onClose}
      width={860}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            className="btn-primary"
            onClick={() => void print()}
            disabled={busy || total === 0}
          >
            <Printer size={15} /> {busy ? 'Printing…' : `Print ${total} labels`}
          </button>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {message && <p className="preview-ok">{message}</p>}

      <div className="row">
        <Field label="Sheet" htmlFor="lb-sheet" plainLabel>
          <select
            id="lb-sheet"
            value={sheet}
            onChange={(e) => setSheet(e.target.value as LabelSheet)}
          >
            {LABEL_SHEETS.map((id) => (
              <option key={id} value={id}>
                {SHEET_SPECS[id].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price list" htmlFor="lb-level" plainLabel>
          <select
            id="lb-level"
            value={priceLevel}
            onChange={(e) => setPriceLevel(e.target.value as PriceLevel)}
          >
            {PRICE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {PRICE_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Skip labels" htmlFor="lb-skip" hint="On a part-used sheet" plainLabel>
          <input
            id="lb-skip"
            type="number"
            min={0}
            max={100}
            value={skip}
            onChange={(e) => setSkip(Number(e.target.value) || 0)}
          />
        </Field>
      </div>

      <div className="row">
        <Field label="Printer" htmlFor="lb-printer" plainLabel>
          <select
            id="lb-printer"
            value={printerName}
            onChange={(e) => setPrinterName(e.target.value)}
          >
            <option value="">Ask when printing</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName || p.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="check" style={{ alignSelf: 'center' }}>
          <input type="checkbox" checked={showMrp} onChange={(e) => setShowMrp(e.target.checked)} />
          <span>Show MRP struck through</span>
        </label>
      </div>

      <div className="table-wrap" style={{ marginBottom: 14, maxHeight: 180 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Product</th>
              <th>Code</th>
              <th className="num">Labels</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <strong>{product.name}</strong>
                </td>
                <td className="mono">{product.barcode ?? product.sku ?? '—'}</td>
                <td className="num">
                  <input
                    className="price-input"
                    type="number"
                    min={0}
                    max={200}
                    value={counts[product.id] ?? 0}
                    aria-label={`Labels for ${product.name}`}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [product.id]: Number(e.target.value) || 0 }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview ? (
        <iframe className="label-preview" title="Label sheet" srcDoc={preview} />
      ) : (
        <p className="empty">
          <Tag size={16} /> Set a number against a product to see the sheet.
        </p>
      )}
    </Modal>
  );
}
