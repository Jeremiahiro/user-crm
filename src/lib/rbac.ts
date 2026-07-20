import type { SessionUser } from '../types/domain'
import { supabaseAdmin } from './supabase'

export const ADMIN_ROLES = ['Super Admin', 'Admin', 'Chapter Leadership']

export function isAdmin(user: SessionUser | undefined | null): boolean {
  return user?.roles?.some(r => ADMIN_ROLES.includes(r)) ?? false
}

export function isMentor(user: SessionUser | undefined | null): boolean {
  return user?.roles?.some(r => r === 'Mentor') ?? false
}

export async function getTeamLeadIds(personId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('person_teams').select('team_id')
    .eq('person_id', personId).eq('is_team_lead', true)
  return new Set(((data ?? []) as { team_id: string }[]).map(r => r.team_id))
}

export async function getTeamMemberIds(personId: string): Promise<Set<string>> {
  const leadTeamIds = await getTeamLeadIds(personId)
  if (leadTeamIds.size === 0) return new Set()
  const { data } = await supabaseAdmin
    .from('person_teams').select('person_id').in('team_id', [...leadTeamIds])
  return new Set(((data ?? []) as { person_id: string }[]).map(r => r.person_id))
}
