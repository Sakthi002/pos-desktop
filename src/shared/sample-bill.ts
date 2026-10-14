/**
 * A bill that never happened, for showing a shop what its template looks like.
 *
 * Built from the same calculation engine as a real sale, so the preview adds
 * up the way the till does: a shop comparing themes is comparing documents it
 * could actually print, not a picture of one.
 */
import { calculateBill } from './billing';
import type { SaleReceipt } from './sale';

export function sampleReceipt(): SaleReceipt {
  const bill = calculateBill({
    lines: [
      {
        productId: 'sample-1',
        name: 'Basmati Rice, 5 kg',
        sku: 'RICE5',
        barcode: null,
        hsn: '1006',
        unitCode: 'pc',
        quantityMilli: 2000,
        unitPricePaise: 49900,
        taxRateBp: 500,
        taxInclusive: true,
        discountPaise: 2000,
      },
      {
        productId: 'sample-2',
        name: 'Sunflower Oil, 1 L',
        sku: 'OIL1',
        barcode: null,
        hsn: '1512',
        unitCode: 'pc',
        quantityMilli: 3000,
        unitPricePaise: 14500,
        taxRateBp: 500,
        taxInclusive: true,
        discountPaise: 0,
      },
      {
        productId: 'sample-3',
        name: 'Washing Powder, 1 kg',
        sku: 'WASH1',
        barcode: null,
        hsn: '3402',
        unitCode: 'kg',
        quantityMilli: 1000,
        unitPricePaise: 11000,
        taxRateBp: 1800,
        taxInclusive: true,
        discountPaise: 0,
      },
    ],
    cartDiscountPaise: 0,
    isInterstate: false,
    roundTotal: true,
  });

  return {
    id: 'sample',
    invoiceNumber: 'SAMPLE-0001',
    invoiceDate: '2026-10-14T11:30:00.000Z',
    financialYear: '2026-27',
    customerId: null,
    customerName: 'Ravi Kumar',
    customerGstin: null,
    bill,
    payments: [
      {
        id: 'sample-payment',
        method: 'upi',
        amountPaise: bill.totalPaise,
        tenderedPaise: bill.totalPaise,
        changePaise: null,
        reference: null,
      },
    ],
    changePaise: 0,
    notes: null,
    status: 'completed',
    voidedAt: null,
    voidReason: null,
    duplicate: false,
    loyalty: null,
    creditPaise: 0,
    priceLevel: 'retail',
  };
}
