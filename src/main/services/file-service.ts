/**
 * File dialogs for CSV import and export.
 *
 * The renderer never touches the filesystem: it asks for a file and receives
 * text, or hands over text and a suggested name. Paths stay in the main process.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { PickedCsv, SavedFile } from '@shared/ipc-contract';

/** A product file far larger than this is almost certainly the wrong file. */
const MAX_CSV_BYTES = 20 * 1024 * 1024;

/**
 * UTF-8 byte order mark. Excel on a default Windows install reads a CSV as the
 * system codepage unless it sees this, which mangles ₹ and Indian names.
 * Written via char code so the literal character never sits in the source.
 */
const UTF8_BOM = String.fromCharCode(0xfeff);

export async function openCsv(window: BrowserWindow): Promise<PickedCsv> {
  const result = await dialog.showOpenDialog(window, {
    title: 'Import products from CSV',
    properties: ['openFile'],
    filters: [{ name: 'CSV files', extensions: ['csv', 'txt'] }],
  });

  const path = result.filePaths[0];
  if (result.canceled || !path) return { content: null, fileName: null };

  const buffer = await readFile(path);
  if (buffer.byteLength > MAX_CSV_BYTES) {
    throw new Error('That file is larger than 20 MB. Split it and import in parts.');
  }

  return { content: buffer.toString('utf8'), fileName: basename(path) };
}

export async function saveCsv(
  window: BrowserWindow,
  suggestedName: string,
  content: string,
): Promise<SavedFile> {
  const result = await dialog.showSaveDialog(window, {
    title: 'Export products to CSV',
    defaultPath: `${app.getPath('documents')}/${suggestedName}`,
    filters: [{ name: 'CSV files', extensions: ['csv'] }],
  });

  if (result.canceled || !result.filePath) return { saved: false, path: null };

  await writeFile(result.filePath, `${UTF8_BOM}${content}`, 'utf8');
  return { saved: true, path: result.filePath };
}

/**
 * Picks a folder for backups. Defaults to the user's Documents, because the
 * point is to land somewhere the shop can copy to a pen drive — not somewhere
 * inside the application's own data.
 */
export async function pickDirectory(window: BrowserWindow): Promise<{ path: string | null }> {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose a backup folder',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });

  const path = result.filePaths[0];
  return { path: result.canceled || !path ? null : path };
}

/** Picks a backup file to restore. The file is validated before anything else. */
export async function pickBackupFile(window: BrowserWindow): Promise<{ path: string | null }> {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose a backup to restore',
    properties: ['openFile'],
    filters: [{ name: 'Backup files', extensions: ['db', 'sqlite', 'sqlite3'] }],
  });

  const path = result.filePaths[0];
  return { path: result.canceled || !path ? null : path };
}
