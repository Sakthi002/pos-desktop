/**
 * Printing and PDF export.
 *
 * The document is rendered in an offscreen window, so the same HTML drives the
 * preview, the PDF and the physical print. Printing happens strictly after a
 * sale has been committed: a failure here can never lose or duplicate a sale,
 * and the invoice can always be reprinted from its stored record.
 */
import { writeFile } from 'node:fs/promises';
import { BrowserWindow, app, dialog } from 'electron';
import type { PaperSize } from '@shared/receipt';
import type { PrinterInfo, PrintOutcome } from '@shared/ipc-contract';
import { readablePrintFailure } from './print-failure';

/** Physical widths in microns, for Electron's pageSize. */
const THERMAL_WIDTH_MICRONS: Record<string, number> = {
  '58mm': 58_000,
  '80mm': 80_000,
};

/**
 * Loads HTML into an offscreen window and hands it to `work`. The window is
 * always destroyed, including on failure, so a print error cannot leak one.
 */
async function withRenderedDocument<T>(
  html: string,
  work: (contents: Electron.WebContents) => Promise<T>,
): Promise<T> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      // A receipt is static markup built by us: it needs no bridge and no Node.
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
    },
  });

  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await work(window.webContents);
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function listPrinters(window: BrowserWindow): Promise<PrinterInfo[]> {
  const printers = await window.webContents.getPrintersAsync();
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    description: p.description ?? '',
    // Electron no longer exposes isDefault directly; where the platform
    // reports it, it arrives among the driver options, which are typed as an
    // open bag of platform-specific values.
    isDefault:
      String((p.options as Record<string, unknown> | undefined)?.['printer-is-default'] ?? '') ===
      'true',
  }));
}

export async function printDocument(
  html: string,
  paperSize: PaperSize,
  printerName: string | null,
  silent: boolean,
): Promise<PrintOutcome> {
  return withRenderedDocument(html, async (contents) => {
    const options: Electron.WebContentsPrintOptions = {
      silent,
      printBackground: true,
      // A roll has no margin to give; a sheet of A4 takes the one the document
      // asks for in @page, which is also the inset the preview shows.
      ...(paperSize === 'a4' ? {} : { margins: { marginType: 'none' as const } }),
      ...(printerName ? { deviceName: printerName } : {}),
      ...(paperSize === 'a4'
        ? {}
        : {
            pageSize: {
              width: THERMAL_WIDTH_MICRONS[paperSize] ?? 80_000,
              // Roll paper: tall enough for any receipt, the printer cuts it.
              height: 297_000,
            },
          }),
    };

    return new Promise<PrintOutcome>((resolve) => {
      const failed = (reason: unknown): void => {
        resolve({
          printed: false,
          reason: readablePrintFailure(reason instanceof Error ? reason.message : String(reason)),
        });
      };

      try {
        contents.print(options, (success, failureReason) => {
          // Cancelling the dialog arrives here too, which is not an error.
          if (success) resolve({ printed: true, reason: null });
          else failed(failureReason ?? '');
        });
      } catch (err) {
        // Electron throws rather than calling back when it cannot reach the
        // print backend at all; a counter should still get a readable line.
        failed(err);
      }
    });
  });
}

/**
 * The document as PDF bytes. Saving it to a chosen file and sending it to a
 * customer are two uses of one rendering, so neither can produce a different
 * sheet from the other.
 */
export async function renderPdf(html: string, paperSize: PaperSize): Promise<Buffer> {
  return withRenderedDocument(html, (contents) =>
    contents.printToPDF({
      printBackground: true,
      ...(paperSize === 'a4'
        ? // 14mm, the same margin the document asks for and the preview shows.
          { pageSize: 'A4', margins: { top: 0.55, bottom: 0.55, left: 0.55, right: 0.55 } }
        : {
            // Inches, as printToPDF expects.
            pageSize: { width: paperSize === '58mm' ? 2.28 : 3.15, height: 11.7 },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
          }),
    }),
  );
}

export async function exportPdf(
  window: BrowserWindow,
  html: string,
  paperSize: PaperSize,
  suggestedName: string,
): Promise<{ saved: boolean; path: string | null }> {
  const result = await dialog.showSaveDialog(window, {
    title: 'Save invoice as PDF',
    defaultPath: `${app.getPath('documents')}/${suggestedName}`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (result.canceled || !result.filePath) return { saved: false, path: null };

  await writeFile(result.filePath, await renderPdf(html, paperSize));
  return { saved: true, path: result.filePath };
}
