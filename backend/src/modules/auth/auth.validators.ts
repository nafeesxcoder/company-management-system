import { z } from 'zod';

/**
 * Password policy: length is the dominant factor in resistance to offline
 * cracking, so the floor is 12 characters with a basic mix requirement.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
  .refine((v) => /[0-9]/.test(v), 'Password must contain a digit');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('A valid email address is required')
  .max(255);

export const clientTypeSchema = z.enum(['web', 'mobile']).default('web');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
  client: clientTypeSchema,
});

export const refreshSchema = z.object({
  /** Mobile sends the token in the body; web sends it in an HttpOnly cookie. */
  refreshToken: z.string().min(16).max(256).optional(),
  client: clientTypeSchema,
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(16).max(256).optional(),
  allDevices: z.boolean().default(false),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  newPassword: passwordSchema,
});

export const acceptInviteSchema = z.object({
  token: z.string().min(32).max(256),
  fullName: z.string().trim().min(2).max(160).optional(),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(160).optional(),
  timezone: z.string().min(2).max(64).optional(),
  locale: z.string().min(2).max(16).optional(),
  avatarUrl: z.string().url().max(512).nullish(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
