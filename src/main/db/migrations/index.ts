import type { Migration } from './types';
import { migration001 } from './001-initial';
import { migration002 } from './002-sale-idempotency';

/** Ordered by version. Append only — never reorder or edit an applied entry. */
export const migrations: Migration[] = [migration001, migration002];

export type { Migration };
