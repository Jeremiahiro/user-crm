import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const UpdateMenteeSchema = z.object({
  full_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional().nullable(),
  school: z.string().optional().nullable(),
  year_group: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  parent_guardian_name: z.string().optional().nullable(),
  parent_guardian_email: z.string().email().optional().nullable(),
  parent_guardian_phone: z.string().optional().nullable(),
  mentor_id: z.string().uuid().optional().nullable(),
  programme_year_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: mentee, error } = await supabaseAdmin
    .from('mentees')
    .select(`
      *,
      people!mentees_mentor_id_fkey(id, full_name, email),
      cmp_programme_years(id, name),
      cmp_attendance(id, status, cmp_sessions(id, title, session_date))
    `)
    .eq('id', params.id ?? '')
    .single()

  if (error || !mentee) {
    return new Response(JSON.stringify({ error: 'Mentee not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data: mentee }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const parsed = UpdateMenteeSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin.from('mentees').select('*').eq('id', params.id ?? '').single()

  const { data: mentee, error } = await supabaseAdmin
    .from('mentees')
    .update(parsed.data)
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !mentee) {
    console.error('[PUT /api/mentees/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to update mentee' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'mentees',
    targetId: mentee.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: mentee as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: mentee }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Block archive if mentee has active CMP attendance
  const { count } = await supabaseAdmin
    .from('cmp_attendance')
    .select('id', { count: 'exact', head: true })
    .eq('mentee_id', params.id ?? '')

  if ((count ?? 0) > 0) {
    return new Response(
      JSON.stringify({ error: 'Cannot archive mentee with attendance records. Please remove attendance records first.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: before } = await supabaseAdmin.from('mentees').select('*').eq('id', params.id ?? '').single()

  const { data: mentee, error } = await supabaseAdmin
    .from('mentees')
    .update({ is_archived: true })
    .eq('id', params.id ?? '')
    .select()
    .single()

  if (error || !mentee) {
    console.error('[DELETE /api/mentees/:id] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to archive mentee' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'archive',
    targetTable: 'mentees',
    targetId: mentee.id as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: mentee as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: mentee }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
