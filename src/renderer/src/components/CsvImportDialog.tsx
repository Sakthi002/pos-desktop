import { useState } from 'react';
import { Upload, FileDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal } from './Modal';
import { call } from '../lib/ipc';
import type { CsvImportResult } from '@shared/catalogue';

export function CsvImportDialog({
  onImported,
  onClose,
}: {
  onImported: () => void;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose() {
    setError(null);
    setResult(null);
    try {
      const picked = await call('dialog:openCsv');
      if (picked.content !== null) {
        setCsv(picked.content);
        setFileName(picked.fileName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function downloadTemplate() {
    try {
      const template = await call('products:csvTemplate');
      await call('dialog:saveCsv', { suggestedName: 'product-template.csv', content: template });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function run() {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await call('products:importCsv', { csv, updateExisting });
      setResult(outcome);
      if (outcome.imported > 0 || outcome.updated > 0) onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Import products from CSV"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            {result ? 'Done' : 'Cancel'}
          </button>
          <button className="btn-primary" onClick={() => void run()} disabled={!csv || busy}>
            {busy ? 'Importing…' : 'Import'}
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
        The file needs at least <strong>name</strong> and <strong>price</strong> columns. Prices are
        in rupees, quantities in the product&apos;s unit.
      </p>

      <div className="csv-actions">
        <button className="btn-info" onClick={() => void choose()} disabled={busy}>
          <Upload size={15} /> Choose file
        </button>
        <button className="btn-info" onClick={() => void downloadTemplate()} disabled={busy}>
          <FileDown size={15} /> Download template
        </button>
        {fileName && <span className="field-hint">{fileName}</span>}
      </div>

      <label className="check" style={{ marginTop: 16 }}>
        <input
          type="checkbox"
          checked={updateExisting}
          onChange={(e) => setUpdateExisting(e.target.checked)}
        />
        <span>Update products whose SKU or barcode already exists</span>
      </label>

      {result && (
        <div className="import-result">
          <p>
            <CheckCircle2 size={15} style={{ verticalAlign: '-2px', color: 'var(--ok)' }} />{' '}
            <strong>{result.imported}</strong> added, <strong>{result.updated}</strong> updated,{' '}
            <strong>{result.skipped}</strong> skipped.
          </p>

          {result.errors.length > 0 && (
            <>
              <p className="import-errors-head">
                <AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> Rows not imported
              </p>
              <div className="import-errors">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Column</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.slice(0, 100).map((e, i) => (
                      <tr key={i}>
                        <td>{e.row}</td>
                        <td>{e.field}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.errors.length > 100 && (
                  <p className="field-hint">
                    …and {result.errors.length - 100} more. Fix these and import again.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
