import { useCallback, useEffect, useRef, useState } from 'react';
import { Save, Image, Check, Printer } from 'lucide-react';
import { Field } from '../components/Field';
import { BackupPanel } from '../components/BackupPanel';
import { AuditPanel } from '../components/AuditPanel';
import { BooksPanel } from '../components/BooksPanel';
import { UsersPanel } from '../components/UsersPanel';
import { LoyaltyPanel } from '../components/LoyaltyPanel';
import { ShiftPanel } from '../components/ShiftPanel';
import { call } from '../lib/ipc';
import { THEME_LABELS, THEME_NOTES } from '@shared/invoice-theme';
import {
  BUSINESS_CATEGORIES,
  INVOICE_THEMES,
  PAYMENT_METHOD_LABELS,
  type AppSettings,
  type SettingsPatch,
} from '@shared/settings';
import { INDIAN_STATES } from '@shared/states';
import type { PrinterInfo } from '@shared/ipc-contract';

type PaymentMethod = AppSettings['payment']['methods'][number];

/** A4 at 96 dpi, which is the size the preview draws itself at. */
const A4_SCREEN_WIDTH_PX = 794;
const A4_SCREEN_HEIGHT_PX = 1123;
type Tab =
  | 'shop'
  | 'invoice'
  | 'receipt'
  | 'template'
  | 'inventory'
  | 'loyalty'
  | 'shifts'
  | 'books'
  | 'users'
  | 'backup'
  | 'audit';

const TABS: { id: Tab; label: string }[] = [
  { id: 'shop', label: 'Shop profile' },
  { id: 'invoice', label: 'Invoicing & tax' },
  { id: 'receipt', label: 'Receipt & payments' },
  { id: 'template', label: 'Bill template' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'loyalty', label: 'Points' },
  { id: 'shifts', label: 'Drawer' },
  { id: 'books', label: 'Accounts' },
  { id: 'users', label: 'Users' },
  { id: 'backup', label: 'Backup & restore' },
  { id: 'audit', label: 'Audit trail' },
];

/** Tabs that act on their own and have nothing for the page's Save button. */
const SELF_SAVING: Tab[] = ['loyalty', 'shifts', 'books', 'users', 'backup', 'audit'];

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
  const [logo, setLogo] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState(0.5);
  const previewWatch = useRef<ResizeObserver | null>(null);

  /**
   * The sample is a whole sheet of A4 drawn at its own size, then shrunk to
   * whatever room the panel has. Letting the frame scroll instead would show a
   * corner of a bill, which tells a shop nothing about the design.
   *
   * Measured through the ref itself rather than from an effect, so the watch
   * moves with the element: one that observed the first node kept reporting
   * that node's width after React had replaced it, and the sheet stayed the
   * size it had been when the panel was narrower.
   */
  const watchPreview = useCallback((node: HTMLDivElement | null) => {
    previewWatch.current?.disconnect();
    previewWatch.current = null;
    if (!node) return;

    const fit = (): void => setPreviewScale(node.clientWidth / A4_SCREEN_WIDTH_PX);
    fit();
    previewWatch.current = new ResizeObserver(fit);
    previewWatch.current.observe(node);
  }, []);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    void call('print:listPrinters')
      .then(setPrinters)
      .catch(() => undefined);
    void call('settings:logo')
      .then((result) => setLogo(result.dataUrl))
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

  /**
   * The sample bill follows the draft, so a theme is seen before it is saved.
   * It is fetched as soon as the page opens rather than when the tab is first
   * shown — a preview that appears a moment after the tab does reads as the
   * app being slow — and typing in the terms box waits for a pause, because
   * every fetch reloads the frame and a frame reloading on each keystroke
   * flickers.
   */
  const template = draft.template;
  useEffect(() => {
    let cancelled = false;
    const run = (): void => {
      void call('settings:templatePreview', template)
        .then((result) => {
          if (!cancelled) setPreview(result.html);
        })
        .catch(() => undefined);
    };

    if (preview === null) {
      run();
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The preview itself is deliberately not a dependency: it is what the
    // effect sets, and only its first absence decides whether to wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

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
        template: draft.template,
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
      if (picked.path) {
        patch('shop', { logoPath: picked.path });
        setLogo(picked.dataUrl);
      }
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
          {!SELF_SAVING.includes(tab) && saved && !dirty && (
            <span className="badge ok">
              <Check size={11} style={{ verticalAlign: '-1px' }} /> Saved
            </span>
          )}
          {!SELF_SAVING.includes(tab) && (
            <button className="btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
              <Save size={15} /> {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
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

      {/* The template tab earns the whole window: it is a page being looked
          at, not a form being filled in. */}
      <div className={tab === 'template' ? 'settings-body wide' : 'settings-body'}>
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
            <Field
              label="Shop logo"
              hint="Printed on receipts and shown beside the shop name. PNG, JPG or WebP, up to 2 MB."
            >
              <div className="logo-row">
                {logo && <img className="logo-preview" src={logo} alt="" />}
                <button type="button" className="btn-secondary" onClick={() => void chooseLogo()}>
                  <Image size={15} /> {draft.shop.logoPath ? 'Replace image' : 'Choose image'}
                </button>
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
            <label className="check">
              <input
                type="checkbox"
                checked={draft.tax.registered}
                onChange={(e) => patch('tax', { registered: e.target.checked })}
              />
              <span>
                This shop is registered for GST
                <em>
                  Off, and nothing is charged, shown or printed as tax. Products keep their rates
                  for the day you register, and past invoices keep their own.
                </em>
              </span>
            </label>

            {draft.tax.registered && (
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
            )}
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
              <button className="btn-info" onClick={() => void testPrint()} disabled={testing}>
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

        {tab === 'template' && (
          <div className="template-tab">
            <div className="template-controls">
            <p className="field-hint" style={{ marginBottom: 12 }}>
              How an A4 bill and a quotation look. The figures and the GST summary are the same in
              every design — what changes is the dress.
            </p>

            <Field label="Design" required>
              <div className="chips">
                {INVOICE_THEMES.map((id) => (
                  <button
                    type="button"
                    key={id}
                    className={draft.template.theme === id ? 'chip on' : 'chip'}
                    onClick={() => patch('template', { theme: id })}
                    aria-pressed={draft.template.theme === id}
                  >
                    {THEME_LABELS[id]}
                  </button>
                ))}
              </div>
            </Field>
            <p className="field-hint" style={{ marginTop: -4 }}>
              {THEME_NOTES[draft.template.theme]}
            </p>

            <div className="row">
              <Field label="Colour" htmlFor="s-accent" hint="Used for rules, headings and the total">
                <div className="logo-row">
                  <input
                    id="s-accent"
                    type="color"
                    className="colour-well"
                    value={draft.template.accent}
                    onChange={(e) => patch('template', { accent: e.target.value.toUpperCase() })}
                  />
                  <input
                    aria-label="Colour as a hex code"
                    value={draft.template.accent}
                    maxLength={7}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase();
                      if (/^#[0-9A-F]{0,6}$/.test(value)) patch('template', { accent: value });
                    }}
                  />
                </div>
              </Field>
              <Field label="Signature line" htmlFor="s-sign" hint="The shop's name when left empty">
                <input
                  id="s-sign"
                  value={draft.template.signatureLabel ?? ''}
                  placeholder={draft.shop.name}
                  onChange={(e) => patch('template', { signatureLabel: e.target.value })}
                />
              </Field>
            </div>

            <Field label="What the bill shows">
              <div className="check-row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.template.showLogo}
                    onChange={(e) => patch('template', { showLogo: e.target.checked })}
                  />
                  <span>Logo</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.template.showHsn}
                    onChange={(e) => patch('template', { showHsn: e.target.checked })}
                  />
                  <span>HSN column</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.template.showDiscount}
                    onChange={(e) => patch('template', { showDiscount: e.target.checked })}
                  />
                  <span>Discount column</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.template.showSignature}
                    onChange={(e) => patch('template', { showSignature: e.target.checked })}
                  />
                  <span>Signature line</span>
                </label>
              </div>
            </Field>

            <Field label="Terms" htmlFor="s-terms" hint="Printed at the foot of an A4 bill">
              <textarea
                id="s-terms"
                rows={2}
                maxLength={500}
                value={draft.template.terms ?? ''}
                placeholder="Goods once sold are not returnable."
                onChange={(e) => patch('template', { terms: e.target.value })}
              />
            </Field>

            <Field
              label="UPI id"
              htmlFor="s-upi"
              hint="With one, the bill carries a code the customer scans to pay the exact amount"
            >
              <input
                id="s-upi"
                value={draft.template.upiId ?? ''}
                placeholder="sharma@okbank"
                onChange={(e) => patch('template', { upiId: e.target.value.trim() })}
              />
            </Field>

            <Field
              label="Payment details"
              htmlFor="s-bank"
              hint="Bank account or anything else a customer paying later needs"
            >
              <textarea
                id="s-bank"
                rows={2}
                maxLength={300}
                value={draft.template.bankDetails ?? ''}
                placeholder="Bank of India · A/c 001234567890 · IFSC BKID0000123"
                onChange={(e) => patch('template', { bankDetails: e.target.value })}
              />
            </Field>

            </div>

            <div className="template-sample">
              <span className="label">How it prints</span>
              <div className="template-preview" ref={watchPreview}>
                {preview ? (
                  <iframe
                    title="Bill preview"
                    srcDoc={preview}
                    sandbox=""
                    style={{
                      width: `${A4_SCREEN_WIDTH_PX}px`,
                      height: `${A4_SCREEN_HEIGHT_PX}px`,
                      transform: `scale(${previewScale})`,
                    }}
                  />
                ) : (
                  <span className="empty-frame">Rendering…</span>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'backup' && (
          <BackupPanel
            settings={settings}
            onSaved={(next) => {
              onSaved(next);
              setDraft(next);
            }}
          />
        )}

        {tab === 'loyalty' && <LoyaltyPanel settings={settings} onSaved={onSaved} />}

        {tab === 'shifts' && <ShiftPanel />}

        {tab === 'books' && <BooksPanel />}

        {tab === 'users' && <UsersPanel settings={settings} onSaved={onSaved} />}

        {tab === 'audit' && <AuditPanel />}

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
