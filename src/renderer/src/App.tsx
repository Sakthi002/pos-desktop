import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { call } from './lib/ipc';
import { SetupWizard } from './pages/SetupWizard';
import { Login, ForcedPasswordChange } from './pages/Login';
import { Placeholder } from './pages/Placeholder';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { Products } from './pages/Products';
import { Categories } from './pages/Categories';
import { Pos } from './pages/Pos';
import { Sales } from './pages/Sales';
import { Quotations } from './pages/Quotations';
import { Inventory } from './pages/Inventory';
import { Customers } from './pages/Customers';
import { Purchases } from './pages/Purchases';
import { Suppliers } from './pages/Suppliers';
import { Reports } from './pages/Reports';
import { AppShell, type Route } from './components/AppShell';
import type { AppInfo, DbStatus } from '@shared/ipc-contract';
import type { AppSettings } from '@shared/settings';
import type { SessionState } from '@shared/auth';
import { can, type Permission } from '@shared/permissions';
import { SessionContext } from './lib/session';

type Phase = 'loading' | 'setup' | 'ready' | 'error';

/** What a screen needs before it is worth showing; the IPC enforces the rest. */
const ROUTE_PERMISSION: Partial<Record<Route, Permission>> = {
  dashboard: 'report.view',
  pos: 'sell',
  sales: 'sale.view',
  quotations: 'sale.view',
  products: 'product.manage',
  categories: 'product.manage',
  inventory: 'report.view',
  purchases: 'purchase.manage',
  suppliers: 'purchase.manage',
  customers: 'customer.manage',
  reports: 'report.view',
  settings: 'settings.manage',
};

const ROUTES: Route[] = [
  'dashboard',
  'pos',
  'sales',
  'quotations',
  'products',
  'categories',
  'inventory',
  'purchases',
  'suppliers',
  'customers',
  'reports',
  'settings',
];

/**
 * The window remembers which screen it was on across a reload, which matters
 * during development and costs nothing in production.
 */
const routeFromHash = (): Route => {
  const candidate = window.location.hash.replace(/^#/, '') as Route;
  return ROUTES.includes(candidate) ? candidate : 'pos';
};

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [db, setDb] = useState<DbStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [auth, setAuth] = useState<SessionState | null>(null);
  /** A quotation the till is about to bill, handed over when the route changes. */
  const [billingQuotation, setBillingQuotation] = useState<string | null>(null);

  const navigate = useCallback((next: Route) => {
    setRoute(next);
    window.location.hash = next;
  }, []);

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    const live = () => !signal?.cancelled;
    try {
      const [appInfo, dbStatus, setupState, session] = await Promise.all([
        call('app:getInfo'),
        call('app:getDbStatus'),
        call('setup:getState'),
        call('auth:session'),
      ]);
      if (!live()) return;
      setAuth(session);
      setInfo(appInfo);
      setDb(dbStatus);

      if (!setupState.isComplete) {
        setPhase('setup');
        return;
      }

      const stored = await call('settings:get');
      if (!live()) return;
      setSettings(stored);
      setPhase('ready');
      console.info('[boot] ready — schema v' + dbStatus.schemaVersion + ', setup complete');
    } catch (err) {
      if (!live()) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, []);

  /**
   * Turning sign-in on takes effect in the main process at once: from that
   * moment every privileged call needs a session this window does not have.
   * Re-reading the session the instant the setting changes is what puts the
   * login screen up — without it the shop is left in a window that looks
   * usable, where even turning the setting back off is refused.
   */
  const requireLogin = settings?.security.requireLogin;
  useEffect(() => {
    if (requireLogin === undefined) return;
    void call('auth:session')
      .then((next) => setAuth(next))
      .catch(() => undefined);
  }, [requireLogin]);

  // The till locks itself after a spell of no use, and the lock happens in the
  // main process. Asking every half minute is what turns that into a screen
  // the cashier actually sees, rather than an error on their next keystroke.
  useEffect(() => {
    if (!auth?.loginRequired || !auth.session) return;
    const timer = setInterval(() => {
      void call('auth:session')
        .then((next) => setAuth(next))
        .catch(() => undefined);
    }, 30_000);
    return () => clearInterval(timer);
  }, [auth?.loginRequired, auth?.session]);

  useEffect(() => {
    // Initial load from the main process. State is only set after the IPC
    // round-trip resolves, and the guard drops a response that arrives after
    // unmount. The lint rule cannot see past the async boundary.
    const signal = { cancelled: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async; see above
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  if (phase === 'loading') {
    return (
      <div className="boot">
        <div className="panel">
          <p className="sub">Starting…</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="boot">
        <div className="panel">
          <h1>
            <AlertTriangle size={18} style={{ verticalAlign: '-3px' }} /> Could not start
          </h1>
          <p className="field-error">{error}</p>
          <button className="btn-primary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'setup') {
    return <SetupWizard onComplete={() => void load()} />;
  }

  // Nobody gets past here while the shop asks for a login. The main process
  // refuses the channels as well: this is the door, not the lock.
  if (auth?.loginRequired && !auth.session) {
    return <Login state={auth} settings={settings} onSignedIn={setAuth} />;
  }

  if (auth?.session?.mustChangePassword) {
    return <ForcedPasswordChange onDone={setAuth} />;
  }

  if (!settings) {
    return <Placeholder info={info} db={db} settings={null} />;
  }

  const allowed = (permission: Permission): boolean =>
    !auth?.loginRequired || !auth.session || can(auth.session.role, permission);

  // A role that cannot open the screen it was last on sees the till instead,
  // which is the one screen every role that can sign in is allowed to use.
  const needed = ROUTE_PERMISSION[route];
  const view: Route = needed && !allowed(needed) ? 'pos' : route;

  return (
    <SessionContext.Provider value={auth}>
      <AppShell
        route={view}
        onNavigate={navigate}
        settings={settings}
        db={db}
        version={info?.version ?? '0.0.0'}
        session={auth?.session ?? null}
        onSignedOut={setAuth}
        allowed={allowed}
      >
        {view === 'pos' && (
          <Pos
            settings={settings}
            quotationId={billingQuotation}
            onQuotationLoaded={() => setBillingQuotation(null)}
          />
        )}
        {view === 'sales' && <Sales settings={settings} />}
        {view === 'quotations' && (
          <Quotations
            onBill={(id) => {
              setBillingQuotation(id);
              navigate('pos');
            }}
          />
        )}
        {view === 'products' && <Products settings={settings} />}
        {view === 'categories' && <Categories />}
        {view === 'inventory' && <Inventory />}
        {view === 'purchases' && <Purchases />}
        {view === 'suppliers' && <Suppliers />}
        {view === 'customers' && <Customers settings={settings} />}
        {view === 'reports' && <Reports settings={settings} />}
        {view === 'settings' && <Settings settings={settings} onSaved={setSettings} />}
        {view === 'dashboard' && <Dashboard onNavigate={navigate} />}
      </AppShell>
    </SessionContext.Provider>
  );
}
