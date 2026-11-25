import { supabaseAdmin } from './supabase'
import { writeAuditLog } from './audit'

export type ElectedBy = 'chapter_vote' | 'board_appointment' | 'co_option'

export interface OfficeRef {
  position_id: string
  title: string
  email: string
}

/**
 * Who a sign-in email belongs to. `via` is set when the email is an office
 * mailbox; `personId` is then the current holder, or null if the office is vacant.
 */
export interface LoginIdentity {
  personId: string | null
  loginEnabled: boolean
  via: OfficeRef | null
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** A person's own email wins; otherwise an active office mailbox resolves to its current holder. */
export async function resolveLoginIdentity(email: string): Promise<LoginIdentity | null> {
  const { data: person } = await supabaseAdmin
    .from('people')
    .select('id, login_enabled')
    .eq('email', email)
    .maybeSingle()

  if (person) {
    return { personId: person.id as string, loginEnabled: Boolean(person.login_enabled), via: null }
  }

  const officeEmail = normaliseEmail(email)
  const { data: office } = await supabaseAdmin
    .from('elected_positions')
    .select('id, title')
    .eq('email', officeEmail)
    .eq('is_active', true)
    .maybeSingle()

  if (!office) return null

  const via: OfficeRef = { position_id: office.id as string, title: office.title as string, email: officeEmail }

  const { data: tenure } = await supabaseAdmin
    .from('elected_position_tenures')
    .select('person_id')
    .eq('position_id', office.id as string)
    .is('term_end', null)
    .maybeSingle()

  if (!tenure) return { personId: null, loginEnabled: false, via }

  const { data: holder } = await supabaseAdmin
    .from('people')
    .select('id, login_enabled, is_archived')
    .eq('id', tenure.person_id as string)
    .maybeSingle()

  if (!holder || holder.is_archived) return { personId: null, loginEnabled: false, via }

  return { personId: holder.id as string, loginEnabled: Boolean(holder.login_enabled), via }
}

/** An office mailbox must not also be someone's personal email, or sign-in would be ambiguous. */
export async function officeEmailConflict(email: string, exceptPositionId?: string): Promise<string | null> {
  const normalised = normaliseEmail(email)

  const { data: person } = await supabaseAdmin
    .from('people')
    .select('id')
    .ilike('email', normalised.replace(/[\\%_]/g, '\\$&'))
    .limit(1)
    .maybeSingle()
  if (person) return 'This email already belongs to a person. Use a dedicated office mailbox.'

  let query = supabaseAdmin.from('elected_positions').select('id').eq('email', normalised).limit(1)
  if (exceptPositionId) query = query.neq('id', exceptPositionId)
  const { data: other } = await query.maybeSingle()
  if (other) return 'Another office already uses this email.'

  return null
}

/** Office mailboxes among the given emails (lowercased), so they aren't reused as personal emails. */
export async function findOfficeEmails(emails: string[]): Promise<Set<string>> {
  const normalised = [...new Set(emails.map(normaliseEmail))]
  if (normalised.length === 0) return new Set()
  const { data } = await supabaseAdmin
    .from('elected_positions')
    .select('email')
    .in('email', normalised)
  return new Set(((data ?? []) as { email: string }[]).map(r => r.email))
}

export const OFFICE_EMAIL_IN_USE = 'This is an office mailbox. Use the person\'s own email address.'

export async function getTeamLeadOfficeId(teamId: string): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from('elected_positions')
    .select('id')
    .eq('team_id', teamId)
    .maybeSingle()
  if (existing) return existing.id as string

  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('name, is_active')
    .eq('id', teamId)
    .maybeSingle()
  if (!team) return null

  const { data: created } = await supabaseAdmin
    .from('elected_positions')
    .insert({
      title: `${team.name as string} Lead`,
      description: `Leads the ${team.name as string} team.`,
      team_id: teamId,
      is_active: team.is_active,
    })
    .select('id')
    .single()
  return (created?.id as string | undefined) ?? null
}

export type AssignResult =
  | { ok: true; tenure: Record<string, unknown> }
  | { ok: false; status: number; error: string }

/**
 * Hands an office to a person: closes the open tenure, opens a new one, and
 * grants the office's linked role. For team lead offices the database trigger
 * moves person_teams.is_team_lead to the new holder.
 */
export async function assignOfficeHolder(input: {
  positionId: string
  personId: string
  termStart: string
  electedBy: ElectedBy
  notes?: string | null
  actorId: string
}): Promise<AssignResult> {
  const { positionId, personId, termStart, electedBy, actorId } = input

  const { data: position } = await supabaseAdmin
    .from('elected_positions')
    .select('id, linked_system_role_id')
    .eq('id', positionId)
    .maybeSingle()

  if (!position) return { ok: false, status: 404, error: 'Position not found' }

  const { data: existingTenure } = await supabaseAdmin
    .from('elected_position_tenures')
    .select('id, person_id')
    .eq('position_id', positionId)
    .is('term_end', null)
    .maybeSingle()

  if (existingTenure?.person_id === personId) {
    return { ok: false, status: 409, error: 'This person already holds this office.' }
  }

  if (existingTenure) {
    const { error: closeError } = await supabaseAdmin
      .from('elected_position_tenures')
      .update({ term_end: termStart })
      .eq('id', existingTenure.id as string)

    if (closeError) {
      console.error('[assignOfficeHolder] Failed to close existing tenure:', closeError)
      return { ok: false, status: 500, error: 'Failed to close existing tenure' }
    }

    await writeAuditLog({
      actorId,
      action: 'tenure_end',
      targetTable: 'elected_position_tenures',
      targetId: existingTenure.id as string,
      afterValue: { term_end: termStart },
    })
  }

  const { data: newTenure, error: createError } = await supabaseAdmin
    .from('elected_position_tenures')
    .insert({
      position_id: positionId,
      person_id: personId,
      term_start: termStart,
      elected_by: electedBy,
      notes: input.notes ?? null,
      created_by: actorId,
    })
    .select()
    .single()

  if (createError || !newTenure) {
    console.error('[assignOfficeHolder] Failed to create tenure:', createError)
    return { ok: false, status: 500, error: 'Failed to create tenure' }
  }

  await writeAuditLog({
    actorId,
    action: 'tenure_create',
    targetTable: 'elected_position_tenures',
    targetId: newTenure.id as string,
    afterValue: newTenure as Record<string, unknown>,
  })

  const linkedRoleId = position.linked_system_role_id as string | null
  if (linkedRoleId) {
    const { error: roleError } = await supabaseAdmin.from('user_roles').insert({
      person_id: personId,
      role_id: linkedRoleId,
      assigned_by: actorId,
    })

    if (roleError && roleError.code !== '23505') {
      console.error('[assignOfficeHolder] Role grant warning:', roleError)
    } else if (!roleError) {
      await writeAuditLog({
        actorId,
        action: 'role_grant',
        targetTable: 'user_roles',
        targetId: personId,
        afterValue: { role_id: linkedRoleId, reason: 'elected_position_auto_grant' },
      })
    }
  }

  return { ok: true, tenure: newTenure as Record<string, unknown> }
}
