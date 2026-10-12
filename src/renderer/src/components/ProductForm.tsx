import { useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { call } from '../lib/ipc';
import { TAX_SLABS, type Product, type Unit, type Category } from '@shared/catalogue';
import { parseRupees, paiseToDecimalString } from '@shared/money';
import { parseQuantity, formatQuantity, precisionFor } from '@shared/quantity';

interface Draft {
  sku: string;
  barcode: string;
  name: string;
  description: string;
  categoryId: string;
  brand: string;
  hsn: string;
  unitCode: string;
  cost: string;
  price: string;
  mrp: string;
  taxRateBp: number;
  taxInclusive: boolean;
  trackInventory: boolean;
  reorderLevel: string;
  openingStock: string;
  isActive: boolean;
}

const emptyDraft = (defaultTaxInclusive: boolean): Draft => ({
  sku: '',
  barcode: '',
  name: '',
  description: '',
  categoryId: '',
  brand: '',
  hsn: '',
  unitCode: 'pc',
  cost: '',
  price: '',
  mrp: '',
  taxRateBp: 0,
  taxInclusive: defaultTaxInclusive,
  trackInventory: true,
  reorderLevel: '',
  openingStock: '',
  isActive: true,
});

const draftFrom = (p: Product): Draft => ({
  sku: p.sku ?? '',
  barcode: p.barcode ?? '',
  name: p.name,
  description: p.description ?? '',
  categoryId: p.categoryId ?? '',
  brand: p.brand ?? '',
  hsn: p.hsn ?? '',
  unitCode: p.unitCode,
  cost: p.costPaise ? paiseToDecimalString(p.costPaise) : '',
  price: paiseToDecimalString(p.pricePaise),
  mrp: p.mrpPaise === null ? '' : paiseToDecimalString(p.mrpPaise),
  taxRateBp: p.taxRateBp,
  taxInclusive: p.taxInclusive,
  trackInventory: p.trackInventory,
  reorderLevel: p.reorderLevelMilli
    ? formatQuantity(p.reorderLevelMilli, precisionFor(p.unitCode))
    : '',
  openingStock: '',
  isActive: p.isActive,
});

export function ProductForm({
  product,
  units,
  categories,
  defaultTaxInclusive,
  onSaved,
  onClose,
}: {
  product: Product | null;
  units: Unit[];
  categories: Category[];
  defaultTaxInclusive: boolean;
  onSaved: (p: Product) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    product ? draftFrom(product) : emptyDraft(defaultTaxInclusive),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key as string];
      return next;
    });
  };

  const precision = precisionFor(draft.unitCode);

  async function submit() {
    const found: Record<string, string> = {};

    if (!draft.name.trim()) found['name'] = 'Product name is required';

    const pricePaise = parseRupees(draft.price);
    if (pricePaise === null || pricePaise < 0) found['price'] = 'Enter a price, e.g. 499.00';

    const costPaise = draft.cost ? parseRupees(draft.cost) : 0;
    if (costPaise === null) found['cost'] = 'Enter a valid cost';

    const mrpPaise = draft.mrp ? parseRupees(draft.mrp) : null;
    if (draft.mrp && mrpPaise === null) found['mrp'] = 'Enter a valid MRP';

    const reorderMilli = draft.reorderLevel ? parseQuantity(draft.reorderLevel, precision) : 0;
    if (draft.reorderLevel && reorderMilli === null) {
      found['reorderLevel'] =
        precision === 0 ? 'Whole numbers only for this unit' : 'Enter a valid quantity';
    }

    const openingMilli = draft.openingStock ? parseQuantity(draft.openingStock, precision) : 0;
    if (draft.openingStock && openingMilli === null) {
      found['openingStock'] =
        precision === 0 ? 'Whole numbers only for this unit' : 'Enter a valid quantity';
    }

    if (draft.hsn && !/^\d{4,8}$/.test(draft.hsn.trim()))
      found['hsn'] = 'HSN must be 4 to 8 digits';

    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    const base = {
      sku: draft.sku.trim(),
      barcode: draft.barcode.trim(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      categoryId: draft.categoryId || null,
      brand: draft.brand.trim(),
      hsn: draft.hsn.trim(),
      unitCode: draft.unitCode,
      costPaise: costPaise ?? 0,
      pricePaise: pricePaise as number,
      mrpPaise,
      taxRateBp: draft.taxRateBp,
      taxInclusive: draft.taxInclusive,
      trackInventory: draft.trackInventory,
      reorderLevelMilli: reorderMilli ?? 0,
      isActive: draft.isActive,
    };

    setSaving(true);
    try {
      const saved = product
        ? await call('products:update', { ...base, id: product.id })
        : await call('products:create', { ...base, openingStockMilli: openingMilli ?? 0 });
      onSaved(saved);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Duplicate errors name their field, so point at it rather than showing
      // a banner the operator has to map back to an input themselves.
      if (/sku/i.test(message)) setErrors({ sku: message });
      else if (/barcode/i.test(message)) setErrors({ barcode: message });
      else setErrors({ form: message });
      setSaving(false);
    }
  }

  return (
    <Modal
      title={product ? `Edit ${product.name}` : 'New product'}
      onClose={onClose}
      width={660}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : product ? 'Save changes' : 'Add product'}
          </button>
        </>
      }
    >
      {errors['form'] && (
        <p className="field-error" role="alert">
          {errors['form']}
        </p>
      )}

      <Field label="Product name" htmlFor="p-name" required error={errors['name']}>
        <input
          id="p-name"
          autoFocus
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Basmati Rice 5kg"
        />
      </Field>

      <div className="row">
        <Field label="SKU" htmlFor="p-sku" error={errors['sku']} hint="Your own code">
          <input id="p-sku" value={draft.sku} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label="Barcode" htmlFor="p-barcode" error={errors['barcode']}>
          <input
            id="p-barcode"
            value={draft.barcode}
            onChange={(e) => set('barcode', e.target.value)}
          />
        </Field>
      </div>

      <div className="row">
        <Field label="Category" htmlFor="p-cat">
          <select
            id="p-cat"
            value={draft.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Unit"
          htmlFor="p-unit"
          required
          hint={precision === 0 ? 'Whole numbers only' : 'Fractions allowed'}
        >
          <select
            id="p-unit"
            value={draft.unitCode}
            onChange={(e) => set('unitCode', e.target.value)}
          >
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row">
        <Field label="Selling price" htmlFor="p-price" required error={errors['price']}>
          <input
            id="p-price"
            inputMode="decimal"
            value={draft.price}
            onChange={(e) => set('price', e.target.value)}
            placeholder="499.00"
          />
        </Field>
        <Field
          label="Purchase cost"
          htmlFor="p-cost"
          error={errors['cost']}
          hint="Used for profit estimates"
        >
          <input
            id="p-cost"
            inputMode="decimal"
            value={draft.cost}
            onChange={(e) => set('cost', e.target.value)}
          />
        </Field>
      </div>

      <div className="row">
        <Field label="MRP" htmlFor="p-mrp" error={errors['mrp']}>
          <input
            id="p-mrp"
            inputMode="decimal"
            value={draft.mrp}
            onChange={(e) => set('mrp', e.target.value)}
          />
        </Field>
        <Field label="GST rate" htmlFor="p-tax" required>
          <select
            id="p-tax"
            value={draft.taxRateBp}
            onChange={(e) => set('taxRateBp', Number(e.target.value))}
          >
            {TAX_SLABS.map((s) => (
              <option key={s.bp} value={s.bp}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row">
        <Field
          label="HSN code"
          htmlFor="p-hsn"
          error={errors['hsn']}
          hint="Required on GST invoices"
        >
          <input id="p-hsn" value={draft.hsn} onChange={(e) => set('hsn', e.target.value)} />
        </Field>
        <Field label="Brand" htmlFor="p-brand">
          <input id="p-brand" value={draft.brand} onChange={(e) => set('brand', e.target.value)} />
        </Field>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={draft.taxInclusive}
          onChange={(e) => set('taxInclusive', e.target.checked)}
        />
        <span>Selling price includes GST</span>
      </label>

      <label className="check" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          checked={draft.trackInventory}
          onChange={(e) => set('trackInventory', e.target.checked)}
        />
        <span>Track stock for this item</span>
      </label>

      {draft.trackInventory && (
        <div className="row" style={{ marginTop: 14 }}>
          {!product && (
            <Field label="Opening stock" htmlFor="p-open" error={errors['openingStock']}>
              <input
                id="p-open"
                inputMode="decimal"
                value={draft.openingStock}
                onChange={(e) => set('openingStock', e.target.value)}
              />
            </Field>
          )}
          <Field
            label="Reorder level"
            htmlFor="p-reorder"
            error={errors['reorderLevel']}
            hint="Warn below this"
          >
            <input
              id="p-reorder"
              inputMode="decimal"
              value={draft.reorderLevel}
              onChange={(e) => set('reorderLevel', e.target.value)}
            />
          </Field>
        </div>
      )}

      {product && (
        <label className="check" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
          <span>Active — available for billing</span>
        </label>
      )}
    </Modal>
  );
}
