import { HardDrive, ShieldCheck } from 'lucide-react';
import type { AppInfo, DbStatus } from '@shared/ipc-contract';
import type { AppSettings } from '@shared/settings';

/**
 * Stands in until the application shell arrives in a later phase. It shows the
 * setup result so a completed wizard is visibly reflected in stored state.
 */
export function Placeholder({
  info,
  db,
  settings,
}: {
  info: AppInfo | null;
  db: DbStatus | null;
  settings: AppSettings | null;
}) {
  return (
    <div className="boot">
      <div className="panel">
        <h1>{settings?.shop.name ?? 'Universal POS'}</h1>
        <p className="sub">Setup complete — billing arrives in a later phase</p>

        {settings && (
          <dl className="facts">
            <dt>Prices</dt>
            <dd>{settings.tax.mode === 'inclusive' ? 'Include tax' : 'Exclude tax'}</dd>
            <dt>Invoice prefix</dt>
            <dd>{settings.invoice.prefix}</dd>
            <dt>Receipt</dt>
            <dd>{settings.receipt.paperSize}</dd>
            <dt>Negative stock</dt>
            <dd>{settings.inventory.allowNegativeStock ? 'Allowed' : 'Blocked'}</dd>
          </dl>
        )}

        {info && db && (
          <dl className="facts" style={{ marginTop: 16 }}>
            <dt>Version</dt>
            <dd>{info.version}</dd>
            <dt>Database</dt>
            <dd>
              <span className={db.connected ? 'badge ok' : 'badge err'}>
                <HardDrive size={11} style={{ verticalAlign: '-1px' }} /> schema v{db.schemaVersion}{' '}
                of {db.latestSchemaVersion}
              </span>
            </dd>
            <dt>Integrity</dt>
            <dd>
              <span className={db.foreignKeys ? 'badge ok' : 'badge err'}>
                <ShieldCheck size={11} style={{ verticalAlign: '-1px' }} />{' '}
                {db.foreignKeys ? 'foreign keys on' : 'foreign keys off'}, {db.journalMode}
              </span>
            </dd>
            <dt>Data location</dt>
            <dd style={{ wordBreak: 'break-all' }}>{info.userDataPath}</dd>
          </dl>
        )}

        <p className="local-note">
          All data is stored locally on this computer. No internet connection is required and none
          is used.
        </p>
      </div>
    </div>
  );
}
