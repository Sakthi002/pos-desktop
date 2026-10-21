import { useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { INDIAN_STATES } from '@shared/states';
import type { Customer } from '@shared/customer';
import { PRICE_LEVELS, PRICE_LEVEL_LABELS, type PriceLevel } from '@shared/trade';

/**
 * A customer needs a name and little else. The state code matters only because
 * it decides CGST+SGST against IGST on their invoices.
 */
export function CustomerForm({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}) {
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [gstin, setGstin] = useState(customer?.gstin ?? '');
  const [stateCode, setStateCode] = useState(customer?.stateCode ?? '');
  const [priceLevel, setPriceLevel] = useState<PriceLevel>(customer?.priceLevel ?? 'retail');
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
        gstin,
        stateCode,
        priceLevel,
        // Kept on the record for what is already stored; a shop is not asked
        // for one, and nothing goes by it.
        creditLimitPaise: customer?.creditLimitPaise ?? 0,
      };
      const saved = customer
        ? await call('customers:update', { id: customer.id, ...payload })
        : await call('customers:create', payload);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={customer ? `Edit ${customer.name}` : 'New customer'}
      onClose={onClose}
      width={560}
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

      <Field label="Name" htmlFor="c-name" required>
        <input id="c-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>

      <div className="row">
        <Field label="Phone" htmlFor="c-phone">
          <input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="c-email">
          <input id="c-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>

      <Field label="Address" htmlFor="c-address">
        <input id="c-address" value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>

      <div className="row">
        <Field label="GSTIN" htmlFor="c-gstin" hint="Only for a business customer">
          <input
            id="c-gstin"
            value={gstin}
            maxLength={15}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="State" htmlFor="c-state" hint="Decides CGST+SGST or IGST">
          <select id="c-state" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
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
        <Field
          label="Price list"
          htmlFor="c-level"
          hint="What this customer is charged by default"
          plainLabel
        >
          <select
            id="c-level"
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
      </div>
    </Modal>
  );
}
