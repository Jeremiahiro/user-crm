import type { APIRoute } from 'astro'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

const CreateMenteeSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Valid email required'),
  phone: z.string().optional().nullable(),
  school: z.string().optional().nullable(),
  year_group: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  parent_guardian_name: z.string().optional().nullable(),
  parent_guardian_email: z.string().email().optional().nullable(),
  parent_guardian_phone: z.string().optional().nullable(),
  mentor_id: z.string().uuid('Mentor must be a valid member').optional().nullable(),
  programme_year_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const mentorId = url.searchParams.get('mentor_id')
  const programmeYearId = url.searchParams.get('programme_year_id')
  const q = url.searchParams.get('q')

  let query = supabaseAdmin
    .from('mentees')
    .select('*, people!mentees_mentor_id_fkey(id, full_name), cmp_programme_years(id, name)')
    .eq('is_archived', false)
    .order('full_name', { ascending: true })

  if (mentorId) query = query.eq('mentor_id', mentorId)
  if (programmeYearId) query = query.eq('programme_year_id', programmeYearId)
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,school.ilike.%${q}%`)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/mentees] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch mentees' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ request, locals }) => {
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

  const parsed = CreateMenteeSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', issues: parsed.error.flatten() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: mentee, error } = await supabaseAdmin
    .from('mentees')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return new Response(JSON.stringify({ error: 'A mentee with this email already exists.' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      })
    }
    console.error('[POST /api/mentees] DB error:', error)
    return new Response(JSON.stringify({ error: 'Failed to create mentee' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'create',
    targetTable: 'mentees',
    targetId: mentee.id as string,
    afterValue: mentee as Record<string, unknown>,
  })

  return new Response(JSON.stringify({ data: mentee }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })
}
