import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  FolderTree,
  Settings as SettingsIcon,
  HardDrive,
} from 'lucide-react';
import type { AppSettings } from '@shared/settings';
import type { DbStatus } from '@shared/ipc-contract';

export type Route = 'dashboard' | 'pos' | 'products' | 'categories' | 'settings';

const NAV: { id: Route; label: string; icon: typeof Package; ready: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, ready: false },
  { id: 'pos', label: 'New Sale', icon: ShoppingCart, ready: true },
  { id: 'products', label: 'Products', icon: Package, ready: true },
  { id: 'categories', label: 'Categories', icon: FolderTree, ready: true },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, ready: true },
];

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
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>{settings.shop.name}</strong>
          <span>{settings.shop.gstin || 'Local billing'}</span>
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
