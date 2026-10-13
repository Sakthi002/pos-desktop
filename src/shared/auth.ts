import { z } from 'zod';
import { ROLES, type Permission, type Role } from './permissions';

/**
 * A password is never stored, never logged, and never crosses the bridge
 * except on its way in. Minimum length rather than a character zoo: a shop
 * that is forced to invent a symbol writes the password on the monitor.
 */
export const passwordSchema = z.string().min(6, 'Use at least 6 characters').max(100);

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(30)
  .regex(/^[a-z0-9._-]+$/i, 'Letters, numbers, dot, dash and underscore only')
  .transform((value) => value.toLowerCase());

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(30),
  password: z.string().min(1).max(100),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(60),
  username: usernameSchema,
  role: z.enum(ROLES),
  password: passwordSchema,
});

export const updateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  role: z.enum(ROLES),
});

export const setUserActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

export const resetPasswordSchema = z.object({
  id: z.string().uuid(),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: passwordSchema,
});

/**
 * A manager standing at the till to approve something a cashier may not do.
 * Their credentials are checked for this one act and no session is started —
 * the cashier stays signed in and the till does not change hands.
 */
export const approvalSchema = z.object({
  username: z.string().trim().min(1).max(30),
  password: z.string().min(1).max(100),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ApprovalInput = z.infer<typeof approvalSchema>;

export interface Session {
  operatorId: string;
  name: string;
  username: string;
  role: Role;
  permissions: Permission[];
  signedInAt: string;
  /** Set when an administrator reset this password and it must be changed. */
  mustChangePassword: boolean;
}

/** What the renderer needs to decide between the app, a login and a lock. */
export interface SessionState {
  /** False while the shop has not turned login on; everyone is the owner. */
  loginRequired: boolean;
  session: Session | null;
  /** True when a session existed and was ended by the idle timer. */
  locked: boolean;
  /** Prefilled on the lock screen so only the password is typed. */
  lastUsername: string | null;
  /**
   * True when the shop lets a manager sign off an act the signed-in role
   * cannot do alone. The screens use it to show the button anyway: the ask
   * comes from the main process, which is where the rule lives.
   */
  approvalAvailable: boolean;
}

export interface UserSummary {
  id: string;
  name: string;
  username: string;
  role: Role;
  isActive: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
