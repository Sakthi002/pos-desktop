/**
 * IPC handler registry.
 *
 * Handlers are registered against the contract. Every incoming payload is parsed
 * with that channel's schema before the handler sees it, and every handler runs
 * inside a try/catch so an exception becomes an error result rather than an
 * unhandled rejection crossing the bridge.
 */
import { ipcMain } from 'electron';
import {
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  type IpcResult,
} from '@shared/ipc-contract';
import { validatePayload } from './validate';

/**
 * The gate every channel passes through once its payload is valid: who is
 * signed in, and whether their role allows this. It is installed rather than
 * imported so the registry stays free of services, and so a test can register
 * handlers with no gate at all.
 */
type Gate = (channel: IpcChannel) => void;

let gate: Gate | null = null;

export function setIpcGate(next: Gate | null): void {
  gate = next;
}

export type Handler<C extends IpcChannel> = (
  payload: IpcRequest<C>,
) => Promise<IpcResponse<C>> | IpcResponse<C>;

export class IpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

export function registerHandler<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (_event, rawPayload): Promise<IpcResult<IpcResponse<C>>> => {
    const parsed = validatePayload(channel, rawPayload);
    if (!parsed.ok) return parsed;

    try {
      gate?.(channel);
      const data = await handler(parsed.data);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof IpcError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      // Log the real error for diagnostics; return a generic message so internal
      // details (paths, SQL) never reach the renderer.
      console.error(`[ipc] ${channel} failed:`, err);
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.' },
      };
    }
  });
}
