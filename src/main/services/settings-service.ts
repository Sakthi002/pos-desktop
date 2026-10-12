/**
 * Settings service.
 *
 * Sections are stored one row per section. Reads merge stored values over the
 * schema defaults, so a settings row added by a later version is absent rather
 * than undefined, and writes are validated before they touch the database.
 */
import type { Database } from 'better-sqlite3';
import {
  appSettingsSchema,
  settingsPatchSchema,
  type AppSettings,
  type SettingsPatch,
} from '@shared/settings';
import { SettingsRepository } from '../db/repositories/settings';

const SECTIONS = ['shop', 'locale', 'invoice', 'tax', 'receipt', 'payment', 'inventory'] as const;

export class SettingsService {
  private readonly repo: SettingsRepository;

  constructor(db: Database) {
    this.repo = new SettingsRepository(db);
  }

  /** Raw stored sections, before defaults are applied. */
  private storedSections(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const section of SECTIONS) {
      const value = this.repo.get<unknown>(`settings.${section}`);
      if (value !== undefined) out[section] = value;
    }
    return out;
  }

  /**
   * Settings are only meaningful once setup has run, because the shop name has
   * no default. Returns null before that.
   */
  get(): AppSettings | null {
    const stored = this.storedSections();
    if (stored['shop'] === undefined) return null;

    const parsed = appSettingsSchema.safeParse(stored);
    if (!parsed.success) {
      // Stored settings that no longer satisfy the schema would otherwise brick
      // the app; surface it rather than silently substituting defaults.
      throw new Error(
        `Stored settings are invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    return parsed.data;
  }

  /** Throws if setup has not completed. */
  require(): AppSettings {
    const settings = this.get();
    if (!settings) throw new Error('Settings are not initialised; run setup first');
    return settings;
  }

  /** Replaces all sections. Used once, by setup. */
  replaceAll(settings: AppSettings): void {
    const valid = appSettingsSchema.parse(settings);
    for (const section of SECTIONS) {
      this.repo.set(`settings.${section}`, valid[section]);
    }
  }

  /**
   * Merges a partial update section by section, validates the result as a
   * whole, then writes only the sections that changed.
   */
  update(patch: SettingsPatch): AppSettings {
    const validPatch = settingsPatchSchema.parse(patch);
    const current = this.require();

    const merged: Record<string, unknown> = {};
    for (const section of SECTIONS) {
      merged[section] = { ...current[section], ...(validPatch[section] ?? {}) };
    }

    const next = appSettingsSchema.parse(merged);

    for (const section of SECTIONS) {
      if (validPatch[section] !== undefined) {
        this.repo.set(`settings.${section}`, next[section]);
      }
    }
    return next;
  }

  isSetupComplete(): boolean {
    return this.repo.get<boolean>('setup.completed') === true;
  }

  markSetupComplete(): void {
    this.repo.set('setup.completed', true);
    this.repo.set('setup.completedAt', new Date().toISOString());
  }
}
