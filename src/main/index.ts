import { join } from 'node:path';
import { app, BrowserWindow, shell, session } from 'electron';
import { registerIpcHandlers } from './ipc';
import {
  openDatabase,
  closeDatabase,
  reopenDatabase,
  getDatabase,
  getDatabasePath,
} from './db/connection';
import { startBackupScheduler } from './services/backup-scheduler';

const isDev = !app.isPackaged;

let stopBackupScheduler: (() => void) | null = null;

/**
 * Content Security Policy.
 *
 * Dev needs 'unsafe-inline' for styles and a websocket for HMR; production gets
 * neither. Nothing may be loaded from the network in either mode.
 */
function contentSecurityPolicy(): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    isDev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    isDev ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'",
    "object-src 'none'",
    // The invoice preview is a sandboxed srcdoc iframe, which counts as 'self'.
    "frame-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
  ];
  return directives.join('; ');
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f8fafc',
    title: 'Universal POS',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  // Avoid a white flash while the renderer boots.
  window.once('ready-to-show', () => window.show());

  // Development hook: POS_SHOT captures the window to a PNG once it has
  // painted, so the UI can be inspected without a display attached.
  const shotPath = process.env['POS_SHOT'];
  if (isDev && shotPath) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void window.webContents.capturePage().then(async (image) => {
          const { writeFile } = await import('node:fs/promises');
          await writeFile(shotPath, image.toPNG());
          console.log(`CAPTURED ${shotPath}`);
        });
      }, 2000);
    });
  }

  // Surface renderer console output on the terminal during development, so a
  // failure in the renderer is visible without opening DevTools.
  if (isDev) {
    window.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`);
    });
  }

  // External links open in the user's browser; never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block in-app navigation away from the bundled renderer.
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const devServer = process.env['ELECTRON_RENDERER_URL'];
    const allowed = devServer
      ? target.origin === new URL(devServer).origin
      : target.protocol === 'file:';
    if (!allowed) event.preventDefault();
  });

  // Development hook: POS_ROUTE opens the window on a given screen, so a
  // capture can target one without clicking through the app first.
  const route = isDev ? process.env['POS_ROUTE'] : undefined;

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) {
    void window.loadURL(route ? `${devServer}#${route}` : devServer);
  } else {
    const indexHtml = join(import.meta.dirname, '../renderer/index.html');
    void (route ? window.loadFile(indexHtml, { hash: route }) : window.loadFile(indexHtml));
  }

  return window;
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
      },
    });
  });

  // Deny every permission request: this app needs none of them.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  openDatabase();
  registerIpcHandlers();
  createWindow();

  stopBackupScheduler = startBackupScheduler({
    db: () => getDatabase(),
    dbPath: getDatabasePath(),
    appVersion: app.getVersion(),
    closeDb: closeDatabase,
    openDb: reopenDatabase,
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopBackupScheduler?.();
  closeDatabase();
});
