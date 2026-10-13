/**
 * Backup and restore.
 *
 * A shop's whole history lives in one SQLite file. Copying that file by hand is
 * not safe — recent writes can still be sitting in the write-ahead log — so a
 * backup always goes through SQLite's own backup API, and the result is checked
 * before it is reported as a backup.
 */
import { z } from 'zod';

export const backupRunSchema = z.object({
  /** Overrides the configured folder for a one-off backup. */
  directory: z.string().max(500).nullable().optional(),
  /** Recorded on the file, so a scheduled run can be told from a manual one. */
  trigger: z.enum(['manual', 'scheduled']).default('manual'),
});

export type BackupRunInput = z.infer<typeof backupRunSchema>;

export const restoreSchema = z.object({
  path: z.string().min(1).max(1000),
  /** The operator has read the warning and typed the confirmation. */
  confirmed: z.literal(true),
});

export type RestoreInput = z.infer<typeof restoreSchema>;

export interface BackupFile {
  path: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  /** Read from inside the file; null when it is not one of ours. */
  schemaVersion: number | null;
  appVersion: string | null;
  trigger: string | null;
}

export interface BackupResult {
  file: BackupFile;
  /** Files removed by the retention rule, oldest first. */
  pruned: string[];
}

export interface RestoreResult {
  restoredFrom: string;
  /** The copy taken of the live database before it was replaced. */
  safetyCopyPath: string;
  schemaVersion: number;
  /** True when the restored file was older and had to be migrated forward. */
  migrated: boolean;
}

/** What a backup file claims about itself, checked before any restore. */
export interface BackupInspection {
  path: string;
  valid: boolean;
  reason: string | null;
  schemaVersion: number | null;
  appVersion: string | null;
  createdAt: string | null;
  sales: number | null;
}
