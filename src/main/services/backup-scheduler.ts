/**
 * Automatic backups.
 *
 * A shop will not remember to take one. The scheduler checks shortly after
 * start and then hourly, so a till that is switched on at nine and off at nine
 * still gets its daily backup, and a day the shop stayed shut is caught the
 * next time it opens rather than skipped.
 *
 * A failure is logged and never surfaces as a dialog: an automatic backup must
 * not interrupt someone serving a customer. The Backup screen shows when the
 * last one actually ran.
 */
import { BackupService, isBackupDue, type BackupDeps } from './backup-service';
import { SettingsService } from './settings-service';

const HOUR = 60 * 60 * 1000;
const SETTLE = 15 * 1000;

export function startBackupScheduler(deps: BackupDeps): () => void {
  const service = new BackupService(deps);

  const check = async (): Promise<void> => {
    try {
      const settings = new SettingsService(deps.db()).get();
      if (!settings || !isBackupDue(settings, new Date())) return;

      const result = await service.run({ trigger: 'scheduled' });
      console.log(`[backup] scheduled backup written to ${result.file.path}`);
    } catch (err) {
      console.error('[backup] scheduled backup failed:', err);
    }
  };

  // Not at startup itself: the first seconds belong to opening the window.
  const settle = setTimeout(() => void check(), SETTLE);
  const timer = setInterval(() => void check(), HOUR);

  return () => {
    clearTimeout(settle);
    clearInterval(timer);
  };
}
