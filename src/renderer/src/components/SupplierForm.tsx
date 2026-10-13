import { useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { parseRupees } from '@shared/money';
import { INDIAN_STATES } from '@shared/states';
import type { Supplier } from '@shared/purchasing';

/**
 * A supplier needs a name; everything else earns its place. The state code is
 * here because it decides CGST+SGST against IGST on what we buy from them.
 */
export function SupplierForm({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
}) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [city, setCity] = useState(supplier?.city ?? '');
  const [gstin, setGstin] = useState(supplier?.gstin ?? '');
  const [stateCode, setStateCode] = useState(supplier?.stateCode ?? '');
  const [creditLimit, setCreditLimit] = useState(
    supplier?.creditLimitPaise ? (supplier.creditLimitPaise / 100).toFixed(2) : '',
  );
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name,
        phone,
        email,
        address,
        city,
        gstin,
        stateCode,
        creditLimitPaise: creditLimit ? (parseRupees(creditLimit) ?? 0) : 0,
        notes,
      };
      const saved = supplier
        ? await call('suppliers:update', { id: supplier.id, ...payload })
        : await call('suppliers:create', payload);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={supplier ? `Edit ${supplier.name}` : 'New supplier'}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => void save()}
            disabled={busy || name.trim() === ''}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <Field label="Supplier name" htmlFor="s-name" required>
        <input id="s-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>

      <div className="row">
        <Field label="Phone" htmlFor="s-phone">
          <input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="s-email">
          <input id="s-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>

      <Field label="Address" htmlFor="s-address">
        <input id="s-address" value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>

      <div className="row">
        <Field label="City" htmlFor="s-city">
          <input id="s-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="State" htmlFor="s-state" hint="Decides CGST + SGST or IGST on their bills">
          <select id="s-state" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
            <option value="">Same as the shop</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row">
        <Field label="GSTIN" htmlFor="s-gstin">
          <input
            id="s-gstin"
            value={gstin}
            maxLength={15}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Credit limit" htmlFor="s-credit" hint="What they allow us to owe">
          <input
            id="s-credit"
            className="price-input"
            inputMode="decimal"
            placeholder="0.00"
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="s-notes">
        <input id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
