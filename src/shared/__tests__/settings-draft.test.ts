import { describe, it, expect } from 'vitest';
import { draftSettings, defaultSettings, appSettingsSchema } from '../settings';

describe('wizard draft settings', () => {
  // Regression: the wizard previously initialised with defaultSettings(''),
  // which throws because the schema requires a non-empty shop name. The crash
  // only appeared on screen, not in unit tests.
  it('constructs without throwing, despite an empty shop name', () => {
    expect(() => draftSettings()).not.toThrow();
    expect(draftSettings().shop.name).toBe('');
  });

  it('carries every other default', () => {
    const draft = draftSettings();
    const full = defaultSettings('Anything');

    expect(draft.invoice).toEqual(full.invoice);
    expect(draft.tax).toEqual(full.tax);
    expect(draft.receipt).toEqual(full.receipt);
    expect(draft.payment).toEqual(full.payment);
    expect(draft.inventory).toEqual(full.inventory);
    expect(draft.locale).toEqual(full.locale);
  });

  it('fails validation until a name is supplied', () => {
    expect(appSettingsSchema.safeParse(draftSettings()).success).toBe(false);

    const named = { ...draftSettings(), shop: { ...draftSettings().shop, name: 'Shop' } };
    expect(appSettingsSchema.safeParse(named).success).toBe(true);
  });
});
