/**
 * The books.
 *
 * Account codes are stable strings, not numbers, because the posting rules
 * refer to them by name and a code is a label rather than a quantity. The set
 * below is seeded on setup and is the minimum a shop needs to produce a cash
 * book, a trial balance and a GST position; a shop may add accounts, but these
 * cannot be removed because the rules post to them.
 */
import { z } from 'zod';

export const ACCOUNT_GROUPS = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number];

export const VOUCHER_TYPES = [
  'sale',
  'sale_return',
  'sale_void',
  'purchase',
  'purchase_return',
  'purchase_cancel',
  'receipt',
  'payment',
  'journal',
  'opening',
] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

/** The codes the posting rules use. Changing one of these changes the books. */
export const ACCOUNTS = {
  cash: '1100',
  bank: '1110',
  upi: '1120',
  card: '1130',
  receivable: '1200',
  gstInput: '1400',
  payable: '2100',
  gstOutput: '2200',
  loyalty: '2300',
  capital: '3100',
  openingBalance: '3900',
  sales: '4100',
  salesReturn: '4200',
  discountReceived: '4300',
  roundOff: '4900',
  purchases: '5100',
  purchaseReturn: '5200',
  discountAllowed: '5300',
  loyaltyCost: '5400',
} as const;

export interface SeedAccount {
  code: string;
  name: string;
  group: AccountGroup;
  normal: 'debit' | 'credit';
}

/** Seeded once per company, in this order. */
export const CHART_OF_ACCOUNTS: SeedAccount[] = [
  { code: ACCOUNTS.cash, name: 'Cash in hand', group: 'asset', normal: 'debit' },
  { code: ACCOUNTS.bank, name: 'Bank account', group: 'asset', normal: 'debit' },
  { code: ACCOUNTS.upi, name: 'UPI settlement', group: 'asset', normal: 'debit' },
  { code: ACCOUNTS.card, name: 'Card settlement', group: 'asset', normal: 'debit' },
  { code: ACCOUNTS.receivable, name: 'Customers owe us', group: 'asset', normal: 'debit' },
  { code: ACCOUNTS.gstInput, name: 'GST input credit', group: 'asset', normal: 'debit' },
  { code: ACCOUNTS.payable, name: 'We owe suppliers', group: 'liability', normal: 'credit' },
  { code: ACCOUNTS.gstOutput, name: 'GST payable', group: 'liability', normal: 'credit' },
  { code: ACCOUNTS.loyalty, name: 'Loyalty points owed', group: 'liability', normal: 'credit' },
  { code: ACCOUNTS.capital, name: "Owner's capital", group: 'equity', normal: 'credit' },
  { code: ACCOUNTS.openingBalance, name: 'Opening balances', group: 'equity', normal: 'credit' },
  { code: ACCOUNTS.sales, name: 'Sales', group: 'income', normal: 'credit' },
  { code: ACCOUNTS.salesReturn, name: 'Sales returns', group: 'income', normal: 'debit' },
  { code: ACCOUNTS.discountReceived, name: 'Discount received', group: 'income', normal: 'credit' },
  { code: ACCOUNTS.roundOff, name: 'Round off', group: 'income', normal: 'credit' },
  { code: ACCOUNTS.purchases, name: 'Purchases', group: 'expense', normal: 'debit' },
  { code: ACCOUNTS.purchaseReturn, name: 'Purchase returns', group: 'expense', normal: 'credit' },
  { code: ACCOUNTS.discountAllowed, name: 'Discount allowed', group: 'expense', normal: 'debit' },
  { code: ACCOUNTS.loyaltyCost, name: 'Loyalty points', group: 'expense', normal: 'debit' },
];

/** Where money of each kind lands. */
export const MONEY_ACCOUNT: Record<string, string> = {
  cash: ACCOUNTS.cash,
  upi: ACCOUNTS.upi,
  card: ACCOUNTS.card,
  bank: ACCOUNTS.bank,
  other: ACCOUNTS.cash,
};

export interface Account {
  id: string;
  code: string;
  name: string;
  group: AccountGroup;
  normalBalance: 'debit' | 'credit';
  isSystem: boolean;
  isActive: boolean;
}

export interface AccountBalance extends Account {
  debitPaise: number;
  creditPaise: number;
  /** Positive in the direction the account normally runs. */
  balancePaise: number;
}

export interface VoucherLine {
  accountCode: string;
  debitPaise?: number;
  creditPaise?: number;
  partyType?: 'customer' | 'supplier';
  partyId?: string;
  narration?: string;
}

export interface VoucherInput {
  type: VoucherType;
  date: string;
  narration: string;
  referenceType?: string;
  referenceId?: string;
  lines: VoucherLine[];
}

export interface LedgerLine {
  id: string;
  voucherNo: string;
  voucherType: VoucherType;
  entryDate: string;
  accountCode: string;
  accountName: string;
  debitPaise: number;
  creditPaise: number;
  narration: string | null;
  partyType: string | null;
  partyId: string | null;
  /** Running balance, when the query asks for one account in order. */
  balancePaise: number;
}

export const ledgerQuerySchema = z.object({
  accountCode: z.string().min(1).max(20),
  fromIso: z.iso.datetime(),
  toIso: z.iso.datetime(),
  limit: z.number().int().min(1).max(2000).default(500),
});

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export interface LedgerStatement {
  account: Account;
  openingPaise: number;
  closingPaise: number;
  lines: LedgerLine[];
}

/**
 * A shop pays rent, wages, electricity and the tea bill out of the same drawer
 * the till fills. None of that is a document this app issues, so it is entered
 * by hand — as a proper two-sided voucher, not a note.
 */
export const journalSchema = z.object({
  dateIso: z.iso.datetime(),
  narration: z.string().trim().min(1).max(200),
  lines: z
    .array(
      z.object({
        accountCode: z.string().min(1).max(20),
        debitPaise: z.number().int().min(0).default(0),
        creditPaise: z.number().int().min(0).default(0),
      }),
    )
    .min(2)
    .max(20),
});

export type JournalInput = z.infer<typeof journalSchema>;

/** A shop's own account, added to the chart beside the seeded ones. */
export const accountInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  group: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
});

export type AccountInput = z.infer<typeof accountInputSchema>;

/**
 * Where a shop's own accounts are numbered, one block per group, clear of the
 * seeded codes so a later version can add a system account without a clash.
 */
export const USER_CODE_BASE: Record<AccountGroup, number> = {
  asset: 1600,
  liability: 2600,
  equity: 3600,
  income: 4600,
  expense: 5600,
};

export const partyStatementSchema = z.object({
  partyType: z.enum(['customer', 'supplier']),
  partyId: z.string().uuid(),
  fromIso: z.iso.datetime(),
  toIso: z.iso.datetime(),
  limit: z.number().int().min(1).max(2000).default(500),
});

export type PartyStatementQuery = z.infer<typeof partyStatementSchema>;

/**
 * One party's side of the control account: what they were owed or owing when
 * the range opened, every document since, and where they stand now.
 */
export interface PartyStatement {
  partyType: 'customer' | 'supplier';
  partyId: string;
  partyName: string;
  /** The control account the party sits under. */
  account: Account;
  openingPaise: number;
  closingPaise: number;
  lines: LedgerLine[];
}

export const openingBalanceSchema = z.object({
  /** Cash counted in the drawer on the day the books start. */
  cashPaise: z.number().int().min(0).default(0),
  bankPaise: z.number().int().min(0).default(0),
  /** What customers already owe, and what is already owed to suppliers. */
  receivablePaise: z.number().int().min(0).default(0),
  payablePaise: z.number().int().min(0).default(0),
  asOfIso: z.iso.datetime(),
});

export type OpeningBalanceInput = z.infer<typeof openingBalanceSchema>;
