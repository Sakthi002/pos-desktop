import { useEffect, useState } from 'react';
import { Save, Image, Check, Printer } from 'lucide-react';
import { Field } from '../components/Field';
import { call } from '../lib/ipc';
import {
  BUSINESS_CATEGORIES,
  PAYMENT_METHOD_LABELS,
  type AppSettings,
  type SettingsPatch,
} from '@shared/settings';
import { INDIAN_STATES } from '@shared/states';
import type { PrinterInfo } from '@shared/ipc-contract';

type PaymentMethod = AppSettings['payment']['methods'][number];
type Tab = 'shop' | 'invoice' | 'receipt' | 'inventory';

const TABS: { id: Tab; label: string }[] = [
  { id: 'shop', label: 'Shop profile' },
  { id: 'invoice', label: 'Invoicing & tax' },
  { id: 'receipt', label: 'Receipt & payments' },
  { id: 'inventory', label: 'Inventory' },
];

/**
 * Edits the settings created during setup.
 *
 * Changes apply to future transactions only. Completed invoices keep their own
 * snapshot, so nothing here rewrites history.
 */
export function Settings({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: (next: AppSettings) => void;
}) {
  const [tab, setTab] = useState<Tab>('shop');
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    void call('print:listPrinters')
      .then(setPrinters)
      .catch(() => undefined);
  }, []);

  async function testPrint() {
    setTesting(true);
    setTestResult(null);
    try {
      const outcome = await call('print:testPage', {
        printerName: draft.receipt.printerName,
        silent: draft.receipt.silentPrint,
      });
      setTestResult(
        outcome.printed ? 'Test page sent to the printer.' : (outcome.reason ?? 'Not printed.'),
      );
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const patch = <S extends keyof AppSettings>(section: S, values: Partial<AppSettings[S]>) => {
    setDraft((d) => ({ ...d, [section]: { ...d[section], ...values } }));
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Send every section; the service merges and validates as a whole.
      const body: SettingsPatch = {
        shop: draft.shop,
        locale: draft.locale,
        invoice: draft.invoice,
        tax: draft.tax,
        receipt: draft.receipt,
        payment: draft.payment,
        inventory: draft.inventory,
      };
      const next = await call('settings:update', body);
      onSaved(next);
      setDraft(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function chooseLogo() {
    try {
      const picked = await call('dialog:pickLogo');
      if (picked.path) patch('shop', { logoPath: picked.path });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const togglePayment = (method: PaymentMethod) =>
    patch('payment', {
      methods: draft.payment.methods.includes(method)
        ? draft.payment.methods.filter((m) => m !== method)
        : [...draft.payment.methods, method],
    });

  return (
    <div className="settings">
      <header className="settings-header">
        <div>
          <h1>Settings</h1>
          <p className="sub">
            Changes apply to future sales. Past invoices keep their own details.
          </p>
        </div>
        <div className="settings-save">
          {saved && !dirty && (
            <span className="badge ok">
              <Check size={11} style={{ verticalAlign: '-1px' }} /> Saved
            </span>
          )}
          <button className="btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      {error && (
        <p className="field-error" role="alert" style={{ padding: '0 32px' }}>
          {error}
        </p>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'tab on' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="settings-body">
        {tab === 'shop' && (
          <>
            <Field label="Shop name" htmlFor="s-name" required>
              <input
                id="s-name"
                value={draft.shop.name}
                onChange={(e) => patch('shop', { name: e.target.value })}
              />
            </Field>
            <Field label="Business type" htmlFor="s-cat" required>
              <select
                id="s-cat"
                value={draft.shop.businessCategory}
                onChange={(e) =>
                  patch('shop', {
                    businessCategory: e.target.value as AppSettings['shop']['businessCategory'],
                  })
                }
              >
                {BUSINESS_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row">
              <Field label="Phone" htmlFor="s-phone">
                <input
                  id="s-phone"
                  value={draft.shop.phone ?? ''}
                  onChange={(e) => patch('shop', { phone: e.target.value })}
                />
              </Field>
              <Field label="Email" htmlFor="s-email">
                <input
                  id="s-email"
                  value={draft.shop.email ?? ''}
                  onChange={(e) => patch('shop', { email: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Address" htmlFor="s-addr">
              <textarea
                id="s-addr"
                rows={2}
                value={draft.shop.address ?? ''}
                onChange={(e) => patch('shop', { address: e.target.value })}
              />
            </Field>
            <div className="row">
              <Field label="City" htmlFor="s-city">
                <input
                  id="s-city"
                  value={draft.shop.city ?? ''}
                  onChange={(e) => patch('shop', { city: e.target.value })}
                />
              </Field>
              <Field label="Pincode" htmlFor="s-pin">
                <input
                  id="s-pin"
                  maxLength={6}
                  value={draft.shop.pincode ?? ''}
                  onChange={(e) => patch('shop', { pincode: e.target.value })}
                />
              </Field>
            </div>
            <Field
              label="State"
              htmlFor="s-state"
              required
              hint="Decides CGST + SGST versus IGST on invoices"
            >
              <select
                id="s-state"
                value={draft.shop.stateCode}
                onChange={(e) => patch('shop', { stateCode: e.target.value })}
              >
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="GSTIN" htmlFor="s-gstin">
              <input
                id="s-gstin"
                maxLength={15}
                style={{ textTransform: 'uppercase' }}
                value={draft.shop.gstin ?? ''}
                onChange={(e) => patch('shop', { gstin: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Shop logo">
              <div className="logo-row">
                <button type="button" className="btn-secondary" onClick={() => void chooseLogo()}>
                  <Image size={15} /> {draft.shop.logoPath ? 'Replace image' : 'Choose image'}
                </button>
                {draft.shop.logoPath && <span className="field-hint">{draft.shop.logoPath}</span>}
              </div>
            </Field>
          </>
        )}

        {tab === 'invoice' && (
          <>
            <div className="row">
              <Field label="Invoice prefix" htmlFor="s-prefix" required>
                <input
                  id="s-prefix"
                  maxLength={10}
                  style={{ textTransform: 'uppercase' }}
                  value={draft.invoice.prefix}
                  onChange={(e) => patch('invoice', { prefix: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field
                label="Start number"
                htmlFor="s-start"
                required
                hint="Applies to the next financial year"
              >
                <input
                  id="s-start"
                  type="number"
                  min={1}
                  value={draft.invoice.startNumber}
                  onChange={(e) => patch('invoice', { startNumber: Number(e.target.value) || 1 })}
                />
              </Field>
            </div>
            <Field label="Price entry" htmlFor="s-taxmode" required>
              <select
                id="s-taxmode"
                value={draft.tax.mode}
                onChange={(e) =>
                  patch('tax', { mode: e.target.value as AppSettings['tax']['mode'] })
                }
              >
                <option value="inclusive">Prices include tax (MRP style)</option>
                <option value="exclusive">Prices exclude tax (added at billing)</option>
              </select>
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.tax.roundTotalToRupee}
                onChange={(e) => patch('tax', { roundTotalToRupee: e.target.checked })}
              />
              <span>Round invoice total to the nearest rupee</span>
            </label>
          </>
        )}

        {tab === 'receipt' && (
          <>
            <Field label="Receipt size" htmlFor="s-paper" required>
              <select
                id="s-paper"
                value={draft.receipt.paperSize}
                onChange={(e) =>
                  patch('receipt', {
                    paperSize: e.target.value as AppSettings['receipt']['paperSize'],
                  })
                }
              >
                <option value="58mm">58 mm thermal</option>
                <option value="80mm">80 mm thermal</option>
                <option value="a4">A4 invoice</option>
              </select>
            </Field>
            <Field label="Payment methods" required>
              <div className="chips">
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => (
                  <button
                    type="button"
                    key={method}
                    className={draft.payment.methods.includes(method) ? 'chip on' : 'chip'}
                    onClick={() => togglePayment(method)}
                    aria-pressed={draft.payment.methods.includes(method)}
                  >
                    {PAYMENT_METHOD_LABELS[method]}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label="Printer"
              htmlFor="s-printer"
              hint="Leave on the system default to choose at print time"
            >
              <select
                id="s-printer"
                value={draft.receipt.printerName ?? ''}
                onChange={(e) => patch('receipt', { printerName: e.target.value || null })}
              >
                <option value="">System default (ask each time)</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                    {p.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </Field>

            <label className="check">
              <input
                type="checkbox"
                checked={draft.receipt.silentPrint}
                onChange={(e) => patch('receipt', { silentPrint: e.target.checked })}
              />
              <span>Print without showing the dialog</span>
            </label>
            <p className="field-hint" style={{ marginTop: 6 }}>
              Silent printing is not supported by every printer or driver. Run a test page before
              relying on it.
            </p>

            <div className="logo-row" style={{ marginTop: 12 }}>
              <button className="btn-secondary" onClick={() => void testPrint()} disabled={testing}>
                <Printer size={15} /> {testing ? 'Printing…' : 'Print test page'}
              </button>
              {testResult && <span className="field-hint">{testResult}</span>}
            </div>

            <Field label="Receipt footer" htmlFor="s-footer">
              <input
                id="s-footer"
                value={draft.receipt.footerText ?? ''}
                onChange={(e) => patch('receipt', { footerText: e.target.value })}
              />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.receipt.showGstBreakdown}
                onChange={(e) => patch('receipt', { showGstBreakdown: e.target.checked })}
              />
              <span>Show the tax breakdown on receipts</span>
            </label>
          </>
        )}

        {tab === 'inventory' && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.inventory.allowNegativeStock}
                onChange={(e) => patch('inventory', { allowNegativeStock: e.target.checked })}
              />
              <span>Allow selling items that are out of stock</span>
            </label>
            <p className="field-hint" style={{ marginTop: 10 }}>
              Off by default. Turning this on lets stock go negative, which hides shortages until
              someone reconciles the count.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
