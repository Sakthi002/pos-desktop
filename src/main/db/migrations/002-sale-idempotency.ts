import type { Migration } from './types';

/**
 * Duplicate-submission guard.
 *
 * The POS generates a key when checkout begins. If the operator double-clicks,
 * or a reply is lost and the renderer retries, the second attempt carries the
 * same key and the unique index makes it resolve to the sale already committed
 * rather than ringing the customer up twice.
 */
export const migration002: Migration = {
  version: 2,
  name: 'sale-idempotency-key',
  up: `
ALTER TABLE sales ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX ux_sales_idempotency
  ON sales (idempotency_key) WHERE idempotency_key IS NOT NULL;
`,
};
