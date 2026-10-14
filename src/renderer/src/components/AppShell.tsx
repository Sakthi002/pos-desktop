import { useEffect, useState, type ReactNode } from 'react';
import { ClipboardList,
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
  FileText,
  Settings as SettingsIcon,
  HardDrive,
  WifiOff,
  Lock,
  LogOut,
} from 'lucide-react';
import { call } from '../lib/ipc';
import type { AppSettings } from '@shared/settings';
import type { DbStatus } from '@shared/ipc-contract';
import type { Session, SessionState } from '@shared/auth';
import { ROLE_LABELS, type Permission } from '@shared/permissions';
import { hueStyle, type Hue } from '../lib/hues';

export type Route =
  | 'dashboard'
  | 'pos'
  | 'sales'
  | 'quotations'
  | 'purchaseOrders'
  | 'products'
  | 'categories'
  | 'inventory'
  | 'purchases'
  | 'suppliers'
  | 'customers'
  | 'reports'
  | 'settings';

interface NavItem {
  id: Route;
  label: string;
  icon: typeof Package;
  needs: Permission;
  /** The screen's own colour, fixed so it never moves between sessions. */
  hue: Hue;
}

const NAV: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    needs: 'report.view',
    hue: 'indigo',
  },
  { id: 'pos', label: 'New Sale', icon: ShoppingCart, needs: 'sell', hue: 'violet' },
  { id: 'sales', label: 'Sales', icon: Receipt, needs: 'sale.view', hue: 'sky' },
  { id: 'quotations', label: 'Quotations', icon: FileText, needs: 'sale.view', hue: 'amber' },
  { id: 'products', label: 'Products', icon: Package, needs: 'product.manage', hue: 'teal' },
  {
    id: 'categories',
    label: 'Categories',
    icon: FolderTree,
    needs: 'product.manage',
    hue: 'amber',
  },
  { id: 'inventory', label: 'Inventory', icon: Boxes, needs: 'report.view', hue: 'rose' },
  {
    id: 'purchaseOrders',
    label: 'Orders',
    icon: ClipboardList,
    needs: 'purchase.manage',
    hue: 'indigo',
  },
  {
    id: 'purchases',
    label: 'Purchases',
    icon: PackagePlus,
    needs: 'purchase.manage',
    hue: 'violet',
  },
  { id: 'suppliers', label: 'Suppliers', icon: Truck, needs: 'purchase.manage', hue: 'sky' },
  { id: 'customers', label: 'Customers', icon: Users, needs: 'customer.manage', hue: 'teal' },
  { id: 'reports', label: 'Reports', icon: BarChart3, needs: 'report.view', hue: 'amber' },
  {
    id: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    needs: 'settings.manage',
    hue: 'indigo',
  },
];

const clockLabel = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const dayLabel = (d: Date): string =>
  d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

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
  session,
  onSignedOut,
  allowed,
  children,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  settings: AppSettings;
  db: DbStatus | null;
  version: string;
  session: Session | null;
  onSignedOut: (next: SessionState) => void;
  allowed: (permission: Permission) => boolean;
  children: ReactNode;
}) {
  const [logo, setLogo] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // The till is where a shop looks for the time, so it keeps itself honest.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(timer);
  }, []);

  // Re-read whenever settings are saved, so replacing the logo shows here
  // without a restart. Watching the path alone is not enough: a logo is always
  // stored as assets/logo.png, so swapping one PNG for another leaves the path
  // identical while the file behind it is a different picture.
  useEffect(() => {
    void call('settings:logo')
      .then((result) => setLogo(result.dataUrl))
      .catch(() => setLogo(null));
  }, [settings]);

  // Billing gets the whole window. Everything else keeps the sidebar, and the
  // bar at the top is how you cross between the two.
  const billing = route === 'pos';

  const brand = (
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
  );

  const leaveTill: Route | null = allowed('report.view')
    ? 'dashboard'
    : allowed('sale.view')
      ? 'sales'
      : null;

  return (
    <div className="shell">
      {!billing && (
        <aside className="sidebar">
          {brand}

          <nav>
            {NAV.filter((item) => allowed(item.needs)).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={route === item.id ? 'nav-item on' : 'nav-item'}
                  style={hueStyle(item.hue)}
                  onClick={() => onNavigate(item.id)}
                >
                  <span className="nav-icon">
                    <Icon size={16} />
                  </span>
                  <span>{item.label}</span>
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
      )}

      <div className="shell-main">
        <header className="topbar">
          {/* With the sidebar away, the bar carries the shop's own name. */}
          {billing && brand}

          {billing
            ? leaveTill && (
                <button className="btn-primary" onClick={() => onNavigate(leaveTill)}>
                  <LayoutDashboard size={15} />
                  {leaveTill === 'dashboard' ? 'Dashboard' : 'Sales'}
                </button>
              )
            : allowed('sell') && (
                <button className="btn-primary" onClick={() => onNavigate('pos')}>
                  <ShoppingCart size={15} /> New sale
                </button>
              )}

          <span className="till-chip">{dayLabel(now)}</span>
          <span className="till-chip mono">{clockLabel(now)}</span>

          <div className="topbar-right">
            <span className="till-chip ghost">
              <WifiOff size={13} /> Works offline · saved on this computer
            </span>

            {session && (
              <div className="who">
                <span className="who-name">
                  <strong>{session.name}</strong>
                  <span>{ROLE_LABELS[session.role]}</span>
                </span>
                <button
                  className="icon-btn"
                  title="Lock the till"
                  onClick={() => void call('auth:lock').then(onSignedOut)}
                >
                  <Lock size={15} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Sign out"
                  onClick={() => void call('auth:logout').then(onSignedOut)}
                >
                  <LogOut size={15} />
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
