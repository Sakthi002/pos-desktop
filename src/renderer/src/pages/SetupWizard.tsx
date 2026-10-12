import { useState, type FormEvent } from 'react';
import {
  Store,
  MapPin,
  Receipt,
  Printer,
  Check,
  ChevronLeft,
  ChevronRight,
  Image,
} from 'lucide-react';
import { Field } from '../components/Field';
import { call } from '../lib/ipc';
import {
  appSettingsSchema,
  draftSettings,
  BUSINESS_CATEGORIES,
  PAYMENT_METHOD_LABELS,
  type AppSettings,
} from '@shared/settings';
import { INDIAN_STATES, stateCodeFromGstin } from '@shared/states';

const STEPS = [
  { id: 'shop', title: 'Shop details', icon: Store },
  { id: 'address', title: 'Address & tax', icon: MapPin },
  { id: 'invoice', title: 'Invoicing', icon: Receipt },
  { id: 'receipt', title: 'Receipt & payments', icon: Printer },
  { id: 'review', title: 'Review', icon: Check },
] as const;

type PaymentMethod = AppSettings['payment']['methods'][number];

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<AppSettings>(draftSettings);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const patch = <S extends keyof AppSettings>(section: S, values: Partial<AppSettings[S]>) =>
    setDraft((d) => ({ ...d, [section]: { ...d[section], ...values } }));

  /** Validates only the fields on the current step, so a later step's blank
   *  required field does not block moving forward. */
  function validateStep(): boolean {
    const found: Record<string, string> = {};

    if (step === 0 && !draft.shop.name.trim()) {
      found['shop.name'] = 'Shop name is required';
    }

    if (step === 1) {
      const result = appSettingsSchema.shape.shop.safeParse(draft.shop);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const key = `shop.${issue.path.join('.')}`;
          // Reported on step 0; do not surface it here.
          if (key !== 'shop.name') found[key] = issue.message;
        }
      }
    }

    if (step === 2) {
      const result = appSettingsSchema.shape.invoice.safeParse(draft.invoice);
      if (!result.success) {
        for (const issue of result.error.issues)
          found[`invoice.${issue.path.join('.')}`] = issue.message;
      }
    }

    if (step === 3 && draft.payment.methods.length === 0) {
      found['payment.methods'] = 'Enable at least one payment method';
    }

    setErrors(found);
    return Object.keys(found).length === 0;
  }

  function next() {
    if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  }

  async function chooseLogo() {
    try {
      const picked = await call('dialog:pickLogo');
      if (picked.path) {
        patch('shop', { logoPath: picked.path });
        setLogoPreview(picked.dataUrl);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const parsed = appSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) found[issue.path.join('.')] = issue.message;
      setErrors(found);
      // Send the operator back to the step that holds the first problem.
      const firstKey = Object.keys(found)[0] ?? '';
      if (firstKey.startsWith('shop.name')) setStep(0);
      else if (firstKey.startsWith('shop.')) setStep(1);
      else if (firstKey.startsWith('invoice.')) setStep(2);
      else setStep(3);
      return;
    }

    setSaving(true);
    try {
      await call('setup:complete', parsed.data);
      onComplete();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  const gstinState = draft.shop.gstin ? stateCodeFromGstin(draft.shop.gstin) : null;
  const gstinMismatch = gstinState !== null && gstinState !== draft.shop.stateCode;

  const togglePayment = (method: PaymentMethod) =>
    patch('payment', {
      methods: draft.payment.methods.includes(method)
        ? draft.payment.methods.filter((m) => m !== method)
        : [...draft.payment.methods, method],
    });

  return (
    <div className="wizard">
      <aside className="wizard-steps">
        <h1>Set up your shop</h1>
        <p className="sub">This takes a minute. Everything can be changed later in Settings.</p>
        <ol>
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.id} className={i === step ? 'current' : i < step ? 'done' : ''}>
                <Icon size={16} />
                <span>{s.title}</span>
              </li>
            );
          })}
        </ol>
        <p className="local-note">
          Your data stays on this computer. No account or internet connection is needed.
        </p>
      </aside>

      <form className="wizard-body" onSubmit={finish}>
        <div className="wizard-content">
          {step === 0 && (
            <>
              <h2>Shop details</h2>
              <Field label="Shop name" htmlFor="name" required error={errors['shop.name']}>
                <input
                  id="name"
                  autoFocus
                  value={draft.shop.name}
                  onChange={(e) => patch('shop', { name: e.target.value })}
                  placeholder="Sharma General Store"
                />
              </Field>
              <Field label="Legal name" htmlFor="legalName" hint="If different from the shop name">
                <input
                  id="legalName"
                  value={draft.shop.legalName ?? ''}
                  onChange={(e) => patch('shop', { legalName: e.target.value })}
                />
              </Field>
              <Field label="Business type" htmlFor="category" required>
                <select
                  id="category"
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
                <Field label="Phone" htmlFor="phone">
                  <input
                    id="phone"
                    value={draft.shop.phone ?? ''}
                    onChange={(e) => patch('shop', { phone: e.target.value })}
                    placeholder="98765 43210"
                  />
                </Field>
                <Field label="Email" htmlFor="email">
                  <input
                    id="email"
                    value={draft.shop.email ?? ''}
                    onChange={(e) => patch('shop', { email: e.target.value })}
                  />
                </Field>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2>Address &amp; tax</h2>
              <Field label="Address" htmlFor="address" hint="Printed on every invoice">
                <textarea
                  id="address"
                  rows={2}
                  value={draft.shop.address ?? ''}
                  onChange={(e) => patch('shop', { address: e.target.value })}
                />
              </Field>
              <div className="row">
                <Field label="City" htmlFor="city">
                  <input
                    id="city"
                    value={draft.shop.city ?? ''}
                    onChange={(e) => patch('shop', { city: e.target.value })}
                  />
                </Field>
                <Field label="Pincode" htmlFor="pincode" error={errors['shop.pincode']}>
                  <input
                    id="pincode"
                    inputMode="numeric"
                    maxLength={6}
                    value={draft.shop.pincode ?? ''}
                    onChange={(e) => patch('shop', { pincode: e.target.value })}
                  />
                </Field>
              </div>
              <Field
                label="State"
                htmlFor="state"
                required
                error={errors['shop.stateCode']}
                hint="Decides whether invoices show CGST + SGST or IGST"
              >
                <select
                  id="state"
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
              <Field
                label="GSTIN"
                htmlFor="gstin"
                error={errors['shop.gstin']}
                hint="Leave blank if not GST registered"
              >
                <input
                  id="gstin"
                  maxLength={15}
                  style={{ textTransform: 'uppercase' }}
                  value={draft.shop.gstin ?? ''}
                  onChange={(e) => patch('shop', { gstin: e.target.value.toUpperCase() })}
                  placeholder="33AAAAA0000A1Z5"
                />
              </Field>
              {gstinMismatch && (
                <p className="warn-note">
                  This GSTIN starts with {gstinState}, which is a different state from the one
                  selected above. Check which is correct.
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h2>Invoicing</h2>
              <div className="row">
                <Field
                  label="Invoice prefix"
                  htmlFor="prefix"
                  required
                  error={errors['invoice.prefix']}
                >
                  <input
                    id="prefix"
                    maxLength={10}
                    style={{ textTransform: 'uppercase' }}
                    value={draft.invoice.prefix}
                    onChange={(e) => patch('invoice', { prefix: e.target.value.toUpperCase() })}
                  />
                </Field>
                <Field
                  label="Start number"
                  htmlFor="startNumber"
                  required
                  error={errors['invoice.startNumber']}
                >
                  <input
                    id="startNumber"
                    type="number"
                    min={1}
                    value={draft.invoice.startNumber}
                    onChange={(e) => patch('invoice', { startNumber: Number(e.target.value) || 1 })}
                  />
                </Field>
              </div>
              <p className="field-hint">
                First invoice will be{' '}
                <strong>
                  {draft.invoice.prefix || 'INV'}-
                  {String(draft.invoice.startNumber).padStart(4, '0')}
                </strong>
                . Numbering restarts each financial year.
              </p>

              <Field
                label="Price entry"
                htmlFor="taxMode"
                required
                hint="How you type prices when adding products"
              >
                <select
                  id="taxMode"
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
                <span>Round invoice total to the nearest rupee, showing the adjustment</span>
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <h2>Receipt &amp; payments</h2>
              <Field label="Receipt size" htmlFor="paper" required>
                <select
                  id="paper"
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

              <Field
                label="Payment methods"
                required
                error={errors['payment.methods']}
                hint="Shown at checkout"
              >
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

              <Field label="Shop logo" hint="Appears on invoices. PNG, JPG or WebP, up to 2 MB">
                <div className="logo-row">
                  <button type="button" className="btn-secondary" onClick={chooseLogo}>
                    <Image size={15} /> Choose image
                  </button>
                  {logoPreview && (
                    <img className="logo-preview" src={logoPreview} alt="Shop logo" />
                  )}
                  {draft.shop.logoPath && !logoPreview && <span>{draft.shop.logoPath}</span>}
                </div>
              </Field>

              <Field label="Receipt footer" htmlFor="footer">
                <input
                  id="footer"
                  value={draft.receipt.footerText ?? ''}
                  onChange={(e) => patch('receipt', { footerText: e.target.value })}
                  placeholder="Thank you. Goods once sold are not returnable."
                />
              </Field>
            </>
          )}

          {step === 4 && (
            <>
              <h2>Review</h2>
              <dl className="facts">
                <dt>Shop</dt>
                <dd>{draft.shop.name}</dd>
                <dt>Type</dt>
                <dd>
                  {BUSINESS_CATEGORIES.find((c) => c.value === draft.shop.businessCategory)?.label}
                </dd>
                <dt>State</dt>
                <dd>
                  {INDIAN_STATES.find((s) => s.code === draft.shop.stateCode)?.name} (
                  {draft.shop.stateCode})
                </dd>
                <dt>GSTIN</dt>
                <dd>{draft.shop.gstin || 'Not registered'}</dd>
                <dt>First invoice</dt>
                <dd>
                  {draft.invoice.prefix}-{String(draft.invoice.startNumber).padStart(4, '0')}
                </dd>
                <dt>Prices</dt>
                <dd>{draft.tax.mode === 'inclusive' ? 'Include tax' : 'Exclude tax'}</dd>
                <dt>Receipt</dt>
                <dd>{draft.receipt.paperSize}</dd>
                <dt>Currency</dt>
                <dd>{draft.locale.currency} (₹)</dd>
                <dt>Time zone</dt>
                <dd>{draft.locale.timezone}</dd>
                <dt>Payments</dt>
                <dd>{draft.payment.methods.map((m) => PAYMENT_METHOD_LABELS[m]).join(', ')}</dd>
              </dl>
              {submitError && (
                <p className="field-error" role="alert">
                  {submitError}
                </p>
              )}
            </>
          )}
        </div>

        <footer className="wizard-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={back}
            disabled={step === 0 || saving}
          >
            <ChevronLeft size={16} /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn-primary" onClick={next}>
              Continue <ChevronRight size={16} />
            </button>
          ) : (
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Setting up…' : 'Finish setup'}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}
