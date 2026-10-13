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
  type SettingsSection,
} from '@shared/settings';
import { SettingsRepository } from '../db/repositories/settings';
import { AuditRepository } from '../db/repositories/audit';

const SECTIONS = [
  'shop',
  'locale',
  'invoice',
  'tax',
  'receipt',
  'payment',
  'inventory',
  'backup',
] as const;

export class SettingsService {
  private readonly repo: SettingsRepository;

  constructor(private readonly db: Database) {
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

    // A section this version added is simply absent in a database written by an
    // older one. Treating it as an empty object lets the schema supply its
    // defaults, instead of failing to load settings and leaving the app unable
    // to start after an update.
    const sections: Record<string, unknown> = {};
    for (const section of SECTIONS) sections[section] = stored[section] ?? {};

    const parsed = appSettingsSchema.safeParse(sections);
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
  update(patch: SettingsPatch, options: { audit?: boolean } = {}): AppSettings {
    const validPatch = settingsPatchSchema.parse(patch);
    const current = this.require();

    // Zod re-applies a field's default when the caller leaves it out, even on
    // a partial schema, so merging the parsed patch wholesale would quietly
    // reset every field the caller did not mention. Only the keys actually
    // sent are taken, with their validated values.
    const sentKeys = (section: SettingsSection): string[] => {
      const raw = (patch as Record<string, unknown>)[section];
      return raw && typeof raw === 'object' ? Object.keys(raw) : [];
    };

    const merged: Record<string, unknown> = {};
    for (const section of SECTIONS) {
      const validSection = (validPatch[section] ?? {}) as Record<string, unknown>;
      const applied = Object.fromEntries(
        sentKeys(section)
          .filter((key) => key in validSection)
          .map((key) => [key, validSection[key]]),
      );
      merged[section] = { ...current[section], ...applied };
    }

    const next = appSettingsSchema.parse(merged);

    const changed: Record<string, unknown> = {};
    for (const section of SECTIONS) {
      if (validPatch[section] === undefined) continue;
      this.repo.set(`settings.${section}`, next[section]);

      for (const key of sentKeys(section)) {
        const value = (next[section] as Record<string, unknown>)[key];
        if ((current[section] as Record<string, unknown>)[key] !== value) {
          changed[`${section}.${key}`] = value;
        }
      }
    }

    // A settings change can alter how every invoice is taxed, so it belongs in
    // the trail. The scheduler's own bookkeeping does not.
    if (options.audit !== false && Object.keys(changed).length > 0) {
      new AuditRepository(this.db).record({
        entityType: 'settings',
        entityId: null,
        action: 'update',
        operatorId: null,
        details: { changed },
      });
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
