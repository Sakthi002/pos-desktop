import type { Migration } from './types';
import { migration001 } from './001-initial';
import { migration002 } from './002-sale-idempotency';
import { migration003 } from './003-no-delete-sales';
import { migration004 } from './004-returns-tax-split';
import { migration005 } from './005-audit-append-only';
import { migration006 } from './006-purchases';

/** Ordered by version. Append only — never reorder or edit an applied entry. */
export const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
];

export type { Migration };
