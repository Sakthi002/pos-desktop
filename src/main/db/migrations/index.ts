import type { Migration } from './types';
import { migration001 } from './001-initial';
import { migration002 } from './002-sale-idempotency';
import { migration003 } from './003-no-delete-sales';
import { migration004 } from './004-returns-tax-split';
import { migration005 } from './005-audit-append-only';
import { migration006 } from './006-purchases';
import { migration007 } from './007-ledger';
import { migration008 } from './008-users';
import { migration009 } from './009-loyalty';
import { migration010 } from './010-batches';
import { migration011 } from './011-trade-terms';
import { migration012 } from './012-quotations';

/** Ordered by version. Append only — never reorder or edit an applied entry. */
export const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
];

export type { Migration };
