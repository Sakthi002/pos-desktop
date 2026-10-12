/**
 * Renderer-side IPC helper.
 *
 * Unwraps the result envelope: callers get the data or a thrown Error, which is
 * what React components and data hooks expect to work with.
 */
import type { IpcChannel, IpcRequest, IpcResponse } from '@shared/ipc-contract';

export class IpcCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IpcCallError';
  }
}

export async function call<C extends IpcChannel>(
  channel: C,
  payload?: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  const result = await window.api.invoke(channel, payload as IpcRequest<C>);
  if (!result.ok) throw new IpcCallError(result.error.code, result.error.message);
  return result.data;
}
