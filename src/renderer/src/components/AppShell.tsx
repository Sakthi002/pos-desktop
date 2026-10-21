import { useEffect, useState, type ReactNode } from 'react';
import {
  ClipboardList,
  LayoutDashboard,
  ShoppingCart,
  PanelLeftClose,
  PanelLeftOpen,
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

/** Where the sidebar's width is remembered between sessions. */
const NAV_WIDTH_KEY = 'pos.sidebar';

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
  // Whether the sidebar is down to its icons. The choice outlives the window:
  // a shop that collapses it once should not find it wide open tomorrow. The
  // guards are for a profile that refuses storage, where it simply does not.
  const [tight, setTight] = useState(() => {
    try {
      return localStorage.getItem(NAV_WIDTH_KEY) === 'tight';
    } catch {
      return false;
    }
  });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    try {
      localStorage.setItem(NAV_WIDTH_KEY, tight ? 'tight' : 'wide');
    } catch {
      /* Nothing to do: the sidebar simply opens wide again next time. */
    }
  }, [tight]);

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

  return (
    <div className={tight ? 'shell tight' : 'shell'}>
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
                title={tight ? item.label : undefined}
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
            <HardDrive size={11} style={{ verticalAlign: '-1px' }} />
            {/* Its own span, so the collapsed rail can keep the mark and drop
                the words with everything else. */}
            <span>Local data</span>
          </span>
          <span className="muted">
            v{version}
            {db ? ` · schema v${db.schemaVersion}` : ''}
          </span>
        </footer>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          {/* The one thing in the bar that is about the sidebar: with the
              sidebar down to its icons, its own header is gone with them. */}
          <button
            className="icon-btn"
            title={tight ? 'Show the menu' : 'Collapse the menu'}
            aria-label={tight ? 'Show the menu' : 'Collapse the menu'}
            aria-expanded={!tight}
            onClick={() => setTight((t) => !t)}
          >
            {tight ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>

          {/* Crossing between screens is the sidebar's job now, so the rest of
              the bar is only what a till looks up: the day and the time. */}
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
