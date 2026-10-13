/**
 * The shape of a manager's sign-off, and how to recognise a refusal that is
 * asking for one. Kept out of the component file so both can be imported
 * without dragging a component along.
 */
export interface Approval {
  username: string;
  password: string;
}

export const EMPTY_APPROVAL: Approval = { username: '', password: '' };

/** True when the shop asked for a manager and the act was refused for it. */
export const needsApproval = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code: string }).code === 'APPROVAL_REQUIRED';
