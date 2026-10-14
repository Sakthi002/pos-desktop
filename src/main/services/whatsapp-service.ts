/**
 * Putting a document on WhatsApp.
 *
 * The app sends nothing itself. It renders the sheet twice — once as a picture
 * the shopkeeper can paste straight into the chat, once as a PDF they can
 * attach — leaves both in a folder they can find again, copies the picture to
 * the clipboard, and opens WhatsApp on the right chat with the message already
 * typed. The last two keystrokes are theirs.
 *
 * That is deliberate. The official API wants a Meta account, an approved
 * template and a fee per conversation; a library that drives WhatsApp Web
 * breaks the terms the shop agreed to and can lose them their number. This way
 * the conversation stays in the shop's own WhatsApp, where the customer can
 * answer it, and costs nothing per message.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, ClipboardItem, app, clipboard, shell } from 'electron';
import type { PaperSize } from '@shared/receipt';
import { renderPdf } from './print-service';

/** A4 at 96 dpi. Wide enough to read on a phone, small enough to send. */
const PAGE_WIDTH_PX = 794;
const MAX_HEIGHT_PX = 6000;

/** Where sent documents are kept, so a shop can find one again a month later. */
export function outboxDirectory(): string {
  return join(app.getPath('documents'), 'POS Outbox');
}

/** Windows will not have a colon or a slash in a file name, and nor will we. */
function safeName(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, '-').trim();
  return cleaned === '' ? 'document' : cleaned.slice(0, 80);
}

/**
 * The document as a picture.
 *
 * The window renders offscreen, so it paints whether or not anything is on
 * screen, and is measured before it is captured — a bill of forty lines is as
 * complete in the picture as a bill of two. JavaScript is on here, which it is
 * not for printing, because the height can only be read from the page itself;
 * the markup is ours and every value in it is escaped, and the window has no
 * bridge, no Node and no way back into the app.
 */
async function renderPng(html: string, widthPx: number): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    width: widthPx,
    // Short on purpose: `scrollHeight` is never less than the window, so a
    // tall window would measure its own emptiness and send a bill with half a
    // page of white under it.
    height: 320,
    backgroundColor: '#ffffff',
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // A page that will not answer is not worth failing a send over: a full
    // sheet's height is a reasonable guess and the PDF carries the document
    // in any case.
    let measured: unknown = null;
    try {
      measured = await window.webContents.executeJavaScript(
        'Math.ceil(document.documentElement.scrollHeight)',
      );
    } catch {
      measured = null;
    }
    const height = typeof measured === 'number' && measured > 0 ? Math.round(measured) : 1123;

    window.setContentSize(widthPx, Math.min(Math.max(height, 200), MAX_HEIGHT_PX));
    await nextPaint(window);

    const image = await window.webContents.capturePage();
    return image.toPNG();
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

/**
 * Waits for the resized page to be drawn. Offscreen rendering reports each
 * frame, but a page that is already settled may not produce another one, so
 * the wait gives up rather than hanging the send.
 */
function nextPaint(window: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const contents = window.webContents;
    const done = (): void => {
      clearTimeout(timer);
      contents.off('paint', done);
      resolve();
    };
    const timer = setTimeout(done, 500);
    contents.once('paint', done);
  });
}

export interface ShareResult {
  folder: string;
  /** Null when the picture could not be rendered; the PDF is always there. */
  imagePath: string | null;
  pdfPath: string;
  link: string;
  /** False when the clipboard refused the picture; the file is still there. */
  imageCopied: boolean;
  /** False when the desktop could not open a browser or WhatsApp. */
  opened: boolean;
  /** False when the file manager could not be opened on the PDF. */
  revealed: boolean;
}

/**
 * Renders, saves, copies, lays the file out and opens — in that order, so that
 * if WhatsApp will not open the shop still has both files, the picture on the
 * clipboard and the PDF sitting selected in a window, and WhatsApp ends up
 * with the focus rather than the file manager.
 */
export async function shareOnWhatsapp(input: {
  html: string;
  /** What the files are called: the document's own number reads best. */
  baseName: string;
  link: string;
  paperSize?: PaperSize;
}): Promise<ShareResult> {
  const paperSize = input.paperSize ?? 'a4';
  const folder = outboxDirectory();
  await mkdir(folder, { recursive: true });

  const base = safeName(input.baseName);
  const imagePath = join(folder, `${base}.png`);
  const pdfPath = join(folder, `${base}.pdf`);

  // The PDF is the document the shop attaches, so it is the one thing here
  // that must work. The picture is a convenience — pasted into a chat when a
  // photo will do — and a send is not failed for want of it.
  const widthPx = paperSize === 'a4' ? PAGE_WIDTH_PX : paperSize === '58mm' ? 384 : 512;
  const picture = renderPng(input.html, widthPx).catch(() => null);

  await writeFile(pdfPath, await renderPdf(input.html, paperSize));

  const png = await picture;
  let imageCopied = false;
  if (png && png.length > 0) {
    await writeFile(imagePath, png);
    try {
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) }),
      ]);
      imageCopied = true;
    } catch {
      // A clipboard that will not take a picture is a nuisance, not a
      // failure: the file is on disk and can be attached by hand.
      imageCopied = false;
    }
  }

  // Nothing can attach a file to WhatsApp from outside it — a wa.me link
  // carries text and nothing else — so the next best thing is to put the PDF
  // in front of the shop, selected, ready to be dragged into the chat.
  let revealed = true;
  try {
    shell.showItemInFolder(pdfPath);
  } catch {
    revealed = false;
  }

  let opened = true;
  try {
    await shell.openExternal(input.link);
  } catch {
    opened = false;
  }

  return {
    folder,
    imagePath: png ? imagePath : null,
    pdfPath,
    link: input.link,
    imageCopied,
    opened,
    revealed,
  };
}

/** Shows the saved files in the shop's own file manager. */
export function revealInFolder(path: string): void {
  shell.showItemInFolder(path);
}
