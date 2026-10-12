/**
 * Shop logo handling.
 *
 * The chosen file is copied into userData rather than referenced in place, so
 * the logo survives the original being moved or deleted, and so backups that
 * cover userData cover the logo too.
 */
import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, basename } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { PickedLogo } from '@shared/ipc-contract';

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_BYTES = 2 * 1024 * 1024;

const assetsDir = (): string => join(app.getPath('userData'), 'assets');

const mimeFor = (ext: string): string =>
  ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

export async function pickLogo(window: BrowserWindow): Promise<PickedLogo> {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose shop logo',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });

  const sourcePath = result.filePaths[0];
  if (result.canceled || !sourcePath) return { path: null, dataUrl: null };

  const ext = extname(sourcePath).toLowerCase();
  if (!ALLOWED.has(ext)) throw new Error('Unsupported image type. Use PNG, JPG or WebP.');

  const bytes = readFileSync(sourcePath);
  if (bytes.byteLength > MAX_BYTES) throw new Error('Logo must be 2 MB or smaller.');

  mkdirSync(assetsDir(), { recursive: true });
  // Fixed name: a shop has one logo, and replacing it should not accumulate files.
  const fileName = `logo${ext}`;
  copyFileSync(sourcePath, join(assetsDir(), fileName));

  return {
    path: join('assets', fileName),
    dataUrl: `data:${mimeFor(ext)};base64,${bytes.toString('base64')}`,
  };
}

/** Reads a stored logo back as a data URI. Returns null if it is missing. */
export function readLogo(relativePath: string): string | null {
  // Reject anything that tries to escape the assets directory.
  const safeName = basename(relativePath);
  const full = join(assetsDir(), safeName);
  if (!existsSync(full)) return null;

  const ext = extname(full).toLowerCase();
  if (!ALLOWED.has(ext)) return null;

  return `data:${mimeFor(ext)};base64,${readFileSync(full).toString('base64')}`;
}
