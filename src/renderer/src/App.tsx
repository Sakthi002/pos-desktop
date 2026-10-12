import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { call } from './lib/ipc';
import { SetupWizard } from './pages/SetupWizard';
import { Placeholder } from './pages/Placeholder';
import { Settings } from './pages/Settings';
import { Products } from './pages/Products';
import { Categories } from './pages/Categories';
import { Pos } from './pages/Pos';
import { AppShell, type Route } from './components/AppShell';
import type { AppInfo, DbStatus } from '@shared/ipc-contract';
import type { AppSettings } from '@shared/settings';

type Phase = 'loading' | 'setup' | 'ready' | 'error';

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [db, setDb] = useState<DbStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>('pos');

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    const live = () => !signal?.cancelled;
    try {
      const [appInfo, dbStatus, setupState] = await Promise.all([
        call('app:getInfo'),
        call('app:getDbStatus'),
        call('setup:getState'),
      ]);
      if (!live()) return;
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

  if (!settings) {
    return <Placeholder info={info} db={db} settings={null} />;
  }

  return (
    <AppShell
      route={route}
      onNavigate={setRoute}
      settings={settings}
      db={db}
      version={info?.version ?? '0.0.0'}
    >
      {route === 'pos' && <Pos settings={settings} />}
      {route === 'products' && <Products settings={settings} />}
      {route === 'categories' && <Categories />}
      {route === 'settings' && <Settings settings={settings} onSaved={setSettings} />}
      {route === 'dashboard' && <Placeholder info={info} db={db} settings={settings} />}
    </AppShell>
  );
}
