/**
 * Who is allowed to do what.
 *
 * Permissions are named after the act, not the screen, because the same act
 * reaches the database from more than one place: a void is a void whether it
 * came from the sales list or a keyboard shortcut. The IPC layer is where this
 * is enforced — the UI hides what a role cannot do, but hiding a button is a
 * courtesy, not a control.
 */

export const ROLES = ['admin', 'manager', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Everything, including users, settings and backups.',
  manager: 'Runs the shop day to day: billing, stock, purchases, reports.',
  cashier: 'Bills customers and looks after their details. Nothing else.',
};

export const PERMISSIONS = [
  'sell',
  'sale.void',
  'sale.view',
  'return.create',
  'product.manage',
  'inventory.adjust',
  'purchase.manage',
  'customer.manage',
  'report.view',
  'books.view',
  'books.post',
  'settings.manage',
  'user.manage',
  'backup.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const CASHIER: Permission[] = ['sell', 'sale.view', 'customer.manage'];

const MANAGER: Permission[] = [
  ...CASHIER,
  'sale.void',
  'return.create',
  'product.manage',
  'inventory.adjust',
  'purchase.manage',
  'report.view',
  'books.view',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  manager: MANAGER,
  cashier: CASHIER,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * The permission each channel demands. A channel absent from this map needs a
 * signed-in operator and nothing more — reading the app's version or the shop's
 * own settings is not a privilege. A channel that writes anything is listed.
 */
export const CHANNEL_PERMISSIONS: Record<string, Permission> = {
  'settings:update': 'settings.manage',
  'settings:templatePreview': 'settings.manage',
  'dialog:pickLogo': 'settings.manage',
  'audit:list': 'settings.manage',

  'catalogue:createCategory': 'product.manage',
  'catalogue:renameCategory': 'product.manage',
  'catalogue:removeCategory': 'product.manage',
  'products:create': 'product.manage',
  'products:update': 'product.manage',
  'products:setActive': 'product.manage',
  'products:remove': 'product.manage',
  'products:importCsv': 'product.manage',
  'products:exportCsv': 'product.manage',
  'products:csvTemplate': 'product.manage',
  'products:adjustStock': 'inventory.adjust',
  'batches:list': 'report.view',
  'batches:save': 'inventory.adjust',

  'loyalty:cards': 'customer.manage',
  'loyalty:issue': 'customer.manage',
  'loyalty:update': 'customer.manage',
  // A correction by hand moves what the shop owes, so it sits with the books.
  'loyalty:adjust': 'books.post',

  'labels:preview': 'product.manage',
  'labels:print': 'product.manage',

  'counter:account': 'sale.view',
  'counter:receipts': 'sale.view',
  'counter:receive': 'sell',
  'shift:current': 'sell',
  'shift:recent': 'report.view',
  'shift:open': 'sell',
  'shift:close': 'sell',

  'customers:create': 'customer.manage',
  'customers:update': 'customer.manage',
  'customers:setActive': 'customer.manage',

  'quotations:create': 'sell',
  'quotations:list': 'sale.view',
  'quotations:get': 'sale.view',
  'quotations:cancel': 'sell',
  'quotations:document': 'sale.view',
  'quotations:print': 'sale.view',
  'quotations:exportPdf': 'sale.view',

  'sales:preview': 'sell',
  'sales:create': 'sell',
  'sales:search': 'sale.view',
  'sales:getReceipt': 'sale.view',
  // 'sales:void' and 'returns:create' are deliberately absent: their handlers
  // run a richer check, because a role that cannot do them alone may still do
  // them with a manager standing behind the counter.

  'returns:getSale': 'sale.view',
  'returns:get': 'sale.view',

  'inventory:movements': 'report.view',
  'inventory:lowStock': 'report.view',
  'reports:run': 'report.view',
  'dashboard:summary': 'report.view',

  'suppliers:list': 'purchase.manage',
  'suppliers:get': 'purchase.manage',
  'suppliers:create': 'purchase.manage',
  'suppliers:update': 'purchase.manage',
  'suppliers:setActive': 'purchase.manage',
  'suppliers:payments': 'purchase.manage',
  'purchases:create': 'purchase.manage',
  'purchases:search': 'purchase.manage',
  'purchases:get': 'purchase.manage',
  'purchases:cancel': 'purchase.manage',
  'purchases:createReturn': 'purchase.manage',
  'purchases:getReturn': 'purchase.manage',
  'purchases:payment': 'purchase.manage',

  'ledger:accounts': 'books.view',
  'ledger:trialBalance': 'books.view',
  'ledger:statement': 'books.view',
  'ledger:partyStatement': 'books.view',
  'ledger:openingBalances': 'books.post',
  'ledger:createAccount': 'books.post',
  'ledger:journal': 'books.post',

  'backup:run': 'backup.manage',
  'backup:list': 'backup.manage',
  'backup:inspect': 'backup.manage',
  'backup:restore': 'backup.manage',
  'dialog:pickBackupDirectory': 'backup.manage',
  'dialog:pickBackupFile': 'backup.manage',

  'users:list': 'user.manage',
  'users:create': 'user.manage',
  'users:update': 'user.manage',
  'users:setActive': 'user.manage',
  'users:resetPassword': 'user.manage',
};

/** Channels that work before anyone has signed in. */
export const PUBLIC_CHANNELS = new Set([
  'app:getInfo',
  'app:getDbStatus',
  'setup:getState',
  'setup:complete',
  'settings:get',
  'settings:logo',
  'auth:session',
  'auth:login',
  'auth:logout',
  'auth:lock',
  'auth:changePassword',
]);
