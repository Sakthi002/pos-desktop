/**
 * Preload bridge.
 *
 * Runs sandboxed with context isolation on. It exposes exactly one function to
 * the renderer and nothing else — no Node, no filesystem, no SQL, no ipcRenderer.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  isChannel,
  type IpcChannel,
  type IpcRequest,
  type IpcResult,
  type IpcResponse,
} from '@shared/ipc-contract';

async function invoke<C extends IpcChannel>(
  channel: C,
  payload?: IpcRequest<C>,
): Promise<IpcResult<IpcResponse<C>>> {
  // Reject unknown channels here as well as in main: defence in depth, and it
  // gives a clearer error than an unhandled-channel rejection from Electron.
  if (!isChannel(channel)) {
    return {
      ok: false,
      error: { code: 'UNKNOWN_CHANNEL', message: `Unknown channel: ${String(channel)}` },
    };
  }
  return ipcRenderer.invoke(channel, payload);
}

const api = { invoke } as const;

export type PosApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
