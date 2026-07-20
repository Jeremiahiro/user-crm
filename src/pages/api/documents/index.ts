/**
 * GET  /api/documents  — list documents
 *   ?person_id=<uuid>    admin/team-lead: any member's docs; member: own only
 *   ?status=<status>     filter by status
 *   ?training_id=<uuid>  filter by training
 *
 * POST /api/documents  — upload a document (multipart/form-data)
 *   Fields: file, document_type_id, title, issued_by?, issued_date?, expiry_date?, training_id?
 *   person_id always set server-side; admins pass ?on_behalf_of=<uuid>
 */
import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { isAdmin, getTeamMemberIds } from '@/lib/rbac'
import { notifyMultiple } from '@/lib/notify'

const BUCKET = 'member-documents'
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const admin = isAdmin(locals.user)
  const requestedPersonId = url.searchParams.get('person_id')
  const statusFilter = url.searchParams.get('status')
  const trainingFilter = url.searchParams.get('training_id')

  let personId: string
  if (requestedPersonId && requestedPersonId !== locals.user.person_id) {
    if (!admin) {
      const memberIds = await getTeamMemberIds(locals.user.person_id)
      if (!memberIds.has(requestedPersonId)) return json({ error: 'Forbidden' }, 403)
    }
    personId = requestedPersonId
  } else {
    personId = requestedPersonId ?? locals.user.person_id
  }

  let query = supabaseAdmin
    .from('documents')
    .select(`
      id, title, status, issued_by, issued_date, expiry_date, file_url, storage_path,
      uploaded_at, reviewed_at, review_notes, training_id,
      document_types(id, name, slug, requires_expiry, requires_issuer),
      reviewer:people!reviewed_by(full_name),
      training:trainings(id, title)
    `)
    .eq('person_id', personId)
    .order('uploaded_at', { ascending: false })

  if (statusFilter) query = query.eq('status', statusFilter)
  if (trainingFilter) query = query.eq('training_id', trainingFilter)

  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)
  return json({ data: data ?? [] })
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  if (!locals.user) return json({ error: 'Unauthorised' }, 401)

  const admin = isAdmin(locals.user)
  const onBehalfOf = url.searchParams.get('on_behalf_of')
  let personId = locals.user.person_id

  if (onBehalfOf && onBehalfOf !== personId) {
    if (!admin) {
      const memberIds = await getTeamMemberIds(locals.user.person_id)
      if (!memberIds.has(onBehalfOf)) return json({ error: 'Forbidden' }, 403)
    }
    personId = onBehalfOf
  }

  let formData: FormData
  try { formData = await request.formData() } catch {
    return json({ error: 'Invalid multipart body' }, 400)
  }

  const file = formData.get('file')
  const documentTypeId = formData.get('document_type_id')?.toString().trim() ?? ''
  const title = formData.get('title')?.toString().trim() ?? ''
  const issuedBy = formData.get('issued_by')?.toString().trim() || null
  const issuedDate = formData.get('issued_date')?.toString() || null
  const expiryDate = formData.get('expiry_date')?.toString() || null
  const trainingId = formData.get('training_id')?.toString() || null

  if (!title) return json({ error: 'Title is required' }, 422)
  if (!documentTypeId) return json({ error: 'Document type is required' }, 422)
  if (!(file instanceof File) || file.size === 0) return json({ error: 'No file provided' }, 422)
  if (!ALLOWED_MIME.includes(file.type)) return json({ error: 'Only PDF, JPEG, PNG, and WebP files are supported' }, 422)
  if (file.size > MAX_BYTES) return json({ error: 'File must be 10 MB or smaller' }, 422)

  // Validate document type
  const { data: docType } = await supabaseAdmin
    .from('document_types').select('id, is_active').eq('id', documentTypeId).single()
  if (!docType?.is_active) return json({ error: 'Invalid document type' }, 422)

  // Validate training if provided
  if (trainingId) {
    const { data: tr } = await supabaseAdmin.from('trainings').select('id').eq('id', trainingId).single()
    if (!tr) return json({ error: 'Training not found' }, 422)
  }

  // Build storage path
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const safeName = title.slice(0, 40).replace(/[^a-z0-9]/gi, '_')
  const storagePath = `${personId}/${Date.now()}_${safeName}.${ext}`
  const buffer = new Uint8Array(await file.arrayBuffer())

  // Ensure bucket exists
  const { error: bucketErr } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ALLOWED_MIME,
  })
  if (bucketErr && !bucketErr.message.includes('already exists')) {
    return json({ error: 'Storage not available' }, 500)
  }

  // Upload file first — DB write only on success
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET).upload(storagePath, buffer, { contentType: file.type, upsert: false })
  if (uploadError) {
    console.error('[POST /api/documents] upload error:', uploadError)
    return json({ error: 'Failed to upload file' }, 500)
  }

  // Generate a long-lived signed URL (1 year); reviewers get fresh ones on demand
  const { data: signedData } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 365)
  const fileUrl = signedData?.signedUrl ?? ''

  // Write DB row
  const { data: doc, error: dbError } = await supabaseAdmin
    .from('documents')
    .insert({ person_id: personId, document_type_id: documentTypeId, title, issued_by: issuedBy, issued_date: issuedDate, expiry_date: expiryDate, training_id: trainingId, file_url: fileUrl, storage_path: storagePath, status: 'pending' })
    .select('id, title, status, uploaded_at, document_types(name), person:people!person_id(full_name)')
    .single()

  if (dbError || !doc) {
    // Roll back storage upload
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath])
    return json({ error: 'Failed to save document record' }, 500)
  }

  // Notify admins + team leads
  const { data: memberTeams } = await supabaseAdmin.from('person_teams').select('team_id').eq('person_id', personId)
  const teamIds = (memberTeams ?? []).map((r: { team_id: string }) => r.team_id)

  const leadIds = new Set<string>()
  if (teamIds.length > 0) {
    const { data: leads } = await supabaseAdmin.from('person_teams').select('person_id').in('team_id', teamIds).eq('is_team_lead', true).neq('person_id', personId)
    for (const r of (leads ?? []) as { person_id: string }[]) leadIds.add(r.person_id)
  }
  const { data: adminUsers } = await supabaseAdmin.from('user_roles').select('person_id, roles!inner(name)').in('roles.name' as any, ['Super Admin', 'Admin', 'Chapter Leadership'])
  for (const r of (adminUsers ?? []) as { person_id: string }[]) leadIds.add(r.person_id)
  leadIds.delete(personId)

  const memberName = (doc as any).person?.full_name ?? 'A member'
  const docTypeName = (doc as any).document_types?.name ?? 'document'
  await notifyMultiple([...leadIds], {
    type: 'document_uploaded',
    title: 'Document uploaded for review',
    body: `${memberName} uploaded a ${docTypeName}: "${title}"`,
    link: `/admin/members/${personId}?tab=documents`,
  })

  return json({ data: doc }, 201)
}
