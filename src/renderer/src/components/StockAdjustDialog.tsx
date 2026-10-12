import { useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import type { Product } from '@shared/catalogue';
import { parseQuantity, formatQuantity, precisionFor } from '@shared/quantity';

/**
 * Stock adjustment. A reason is mandatory: an unexplained change to stock is
 * exactly what makes a count impossible to reconcile later.
 */
export function StockAdjustDialog({
  product,
  onAdjusted,
  onClose,
}: {
  product: Product;
  onAdjusted: (p: Product) => void;
  onClose: () => void;
}) {
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const precision = precisionFor(product.unitCode);
  const parsed = quantity ? parseQuantity(quantity, precision) : null;
  const delta = parsed === null ? null : direction === 'in' ? parsed : -parsed;
  const resulting = delta === null ? product.stockMilli : product.stockMilli + delta;

  async function submit() {
    const found: Record<string, string> = {};
    if (parsed === null || parsed === 0) {
      found['quantity'] = precision === 0 ? 'Enter a whole number' : 'Enter a quantity';
    }
    if (!reason.trim()) found['reason'] = 'A reason is required';
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setSaving(true);
    try {
      const updated = await call('products:adjustStock', {
        productId: product.id,
        deltaMilli: delta as number,
        reason: reason.trim(),
      });
      onAdjusted(updated);
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : String(err) });
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Adjust stock — ${product.name}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : 'Record adjustment'}
          </button>
        </>
      }
    >
      {errors['form'] && (
        <p className="field-error" role="alert">
          {errors['form']}
        </p>
      )}

      <p className="current-stock">
        Current stock: <strong>{formatQuantity(product.stockMilli, precision)}</strong>{' '}
        {product.unitCode}
      </p>

      <Field label="Direction" required>
        <div className="chips">
          <button
            type="button"
            className={direction === 'in' ? 'chip on' : 'chip'}
            onClick={() => setDirection('in')}
          >
            Add stock
          </button>
          <button
            type="button"
            className={direction === 'out' ? 'chip on' : 'chip'}
            onClick={() => setDirection('out')}
          >
            Remove stock
          </button>
        </div>
      </Field>

      <Field label="Quantity" htmlFor="adj-qty" required error={errors['quantity']}>
        <input
          id="adj-qty"
          autoFocus
          inputMode="decimal"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            setErrors({});
          }}
          placeholder={precision === 0 ? '10' : '2.5'}
        />
      </Field>

      <Field
        label="Reason"
        htmlFor="adj-reason"
        required
        error={errors['reason']}
        hint="Stored in the audit trail"
      >
        <input
          id="adj-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setErrors({});
          }}
          placeholder="Stock count correction, damage, expiry…"
        />
      </Field>

      {delta !== null && (
        <p className={resulting < 0 ? 'field-error' : 'field-hint'}>
          New stock will be <strong>{formatQuantity(resulting, precision)}</strong>{' '}
          {product.unitCode}
          {resulting < 0 && ' — stock cannot go below zero'}
        </p>
      )}
    </Modal>
  );
}
