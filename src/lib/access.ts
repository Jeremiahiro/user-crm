import type { SessionUser } from '@/types/domain'

export const ADMIN_ROLES = ['Super Admin', 'Admin', 'Chapter Leadership']

export function isAdmin(user: SessionUser | undefined | null): boolean {
  return user?.roles?.some(r => ADMIN_ROLES.includes(r)) ?? false
}

export function isMentor(user: SessionUser | undefined | null): boolean {
  return user?.roles?.some(r => r === 'Mentor') ?? false
}

/**
 * CMP programme access: admins, the Mentor system role, or a person whose
 * membership types include mentor (the role is not in the original seed).
 */
export function canManageCmp(user: SessionUser | undefined | null): boolean {
  if (!user) return false
  if (isAdmin(user) || isMentor(user)) return true
  return user.person_types?.includes('mentor') ?? false
}
