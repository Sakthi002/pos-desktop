/**
 * The validation gate every IPC channel passes through.
 *
 * It lives apart from the registry so it can be tested without Electron: the
 * point of this code is that a handler never sees a payload it would have
 * rejected, and that guarantee deserves a test that does not need a window.
 */
import {
  ipcContract,
  type IpcChannel,
  type IpcRequest,
  type IpcResult,
} from '@shared/ipc-contract';

export function validatePayload<C extends IpcChannel>(
  channel: C,
  rawPayload: unknown,
): IpcResult<IpcRequest<C>> {
  const parsed = ipcContract[channel].safeParse(rawPayload);
  if (parsed.success) return { ok: true, data: parsed.data as IpcRequest<C> };

  return {
    ok: false,
    error: {
      code: 'INVALID_PAYLOAD',
      message: parsed.error.issues.map((i) => i.message).join('; '),
    },
  };
}
