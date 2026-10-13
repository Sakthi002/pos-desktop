/**
 * Who is signed in, for the screens.
 *
 * The main process decides what is allowed and refuses anything else; this is
 * only so a cashier is not shown a button that would be refused. Hiding is a
 * courtesy, never the control.
 */
import { createContext, useContext } from 'react';
import { can, type Permission } from '@shared/permissions';
import type { SessionState } from '@shared/auth';

export const SessionContext = createContext<SessionState | null>(null);

export function useCan(): (permission: Permission) => boolean {
  const state = useContext(SessionContext);
  return (permission) =>
    !state?.loginRequired || !state.session || can(state.session.role, permission);
}

export function useSession(): SessionState | null {
  return useContext(SessionContext);
}

/**
 * Whether to offer an act this role cannot do alone. The shop may still allow
 * it with a manager's sign-off, and the dialog asks for that when it happens;
 * hiding the button would leave the cashier with no way to ask.
 */
export function useCanWithApproval(): (permission: Permission) => boolean {
  const state = useContext(SessionContext);
  const allowed = useCan();
  return (permission) => allowed(permission) || (state?.approvalAvailable ?? false);
}
