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
  ipcContract,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  type IpcResult,
} from '@shared/ipc-contract';

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
    const parsed = ipcContract[channel].safeParse(rawPayload);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        },
      };
    }

    try {
      const data = await handler(parsed.data as IpcRequest<C>);
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
