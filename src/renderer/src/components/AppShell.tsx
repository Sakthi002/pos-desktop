import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Package,
  Boxes,
  PackagePlus,
  Truck,
  Users,
  BarChart3,
  FolderTree,
  Settings as SettingsIcon,
  HardDrive,
} from 'lucide-react';
import { call } from '../lib/ipc';
import type { AppSettings } from '@shared/settings';
import type { DbStatus } from '@shared/ipc-contract';

export type Route =
  | 'dashboard'
  | 'pos'
  | 'sales'
  | 'products'
  | 'categories'
  | 'inventory'
  | 'purchases'
  | 'suppliers'
  | 'customers'
  | 'reports'
  | 'settings';

const NAV: { id: Route; label: string; icon: typeof Package; ready: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, ready: true },
  { id: 'pos', label: 'New Sale', icon: ShoppingCart, ready: true },
  { id: 'sales', label: 'Sales', icon: Receipt, ready: true },
  { id: 'products', label: 'Products', icon: Package, ready: true },
  { id: 'categories', label: 'Categories', icon: FolderTree, ready: true },
  { id: 'inventory', label: 'Inventory', icon: Boxes, ready: true },
  { id: 'purchases', label: 'Purchases', icon: PackagePlus, ready: true },
  { id: 'suppliers', label: 'Suppliers', icon: Truck, ready: true },
  { id: 'customers', label: 'Customers', icon: Users, ready: true },
  { id: 'reports', label: 'Reports', icon: BarChart3, ready: true },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, ready: true },
];

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();

export function AppShell({
  route,
  onNavigate,
  settings,
  db,
  version,
  children,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  settings: AppSettings;
  db: DbStatus | null;
  version: string;
  children: ReactNode;
}) {
  const [logo, setLogo] = useState<string | null>(null);

  // Re-read when the path changes, so replacing the logo in Settings shows
  // here without a restart.
  useEffect(() => {
    void call('settings:logo')
      .then((result) => setLogo(result.dataUrl))
      .catch(() => setLogo(null));
  }, [settings.shop.logoPath]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {logo ? (
            <img className="brand-mark" src={logo} alt="" />
          ) : (
            <span className="brand-mark initials" aria-hidden="true">
              {initialsOf(settings.shop.name)}
            </span>
          )}
          <span className="brand-text">
            <strong>{settings.shop.name}</strong>
            <span>{settings.shop.gstin || 'Local billing'}</span>
          </span>
        </div>

        <nav>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={route === item.id ? 'nav-item on' : 'nav-item'}
                onClick={() => onNavigate(item.id)}
                disabled={!item.ready}
                title={item.ready ? undefined : 'Arrives in a later phase'}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {!item.ready && <em>soon</em>}
              </button>
            );
          })}
        </nav>

        <footer className="sidebar-foot">
          <span className="badge ok">
            <HardDrive size={11} style={{ verticalAlign: '-1px' }} /> Local data
          </span>
          <span className="muted">
            v{version}
            {db ? ` · schema v${db.schemaVersion}` : ''}
          </span>
        </footer>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
