/**
 * Chromium's words for a failed print, turned into words a shopkeeper can act
 * on. Every print path — receipt, quotation, label sheet, test page — goes
 * through here, so a counter never sees a browser engine's diagnostics.
 */

/** No printer is installed, or the print backend could not be reached. */
const NO_PRINTER = /enumerate printers|no valid printer|printer not found/i;

/** The chosen printer has since been removed or renamed. */
const GONE = /invalid devicename/i;

export function readablePrintFailure(reason: string): string {
  const text = reason.trim();

  // An empty reason is how a cancelled print dialog arrives, not a fault.
  if (!text) return 'Printing was cancelled.';

  if (NO_PRINTER.test(text))
    return 'No printer is set up on this computer. Add one in the system printer settings, then try again.';

  if (GONE.test(text))
    return 'That printer is no longer available. Choose another one in Settings.';

  return text;
}
