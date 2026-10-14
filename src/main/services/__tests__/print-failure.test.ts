import { describe, expect, it } from 'vitest';
import { readablePrintFailure } from '../print-failure';

describe('readablePrintFailure', () => {
  it('reads an empty reason as a cancelled dialog', () => {
    expect(readablePrintFailure('')).toBe('Printing was cancelled.');
    expect(readablePrintFailure('   ')).toBe('Printing was cancelled.');
  });

  it('explains a computer with no printer installed', () => {
    // Chromium's own words when the print backend lists nothing.
    expect(readablePrintFailure('Failed to enumerate printers')).toMatch(/No printer is set up/);
    expect(readablePrintFailure('No valid printer available')).toMatch(/No printer is set up/);
  });

  it('points a removed printer back at Settings', () => {
    expect(readablePrintFailure('Invalid deviceName provided')).toMatch(/no longer available/);
  });

  it('passes an unfamiliar reason through unchanged', () => {
    expect(readablePrintFailure('Out of paper')).toBe('Out of paper');
  });
});
