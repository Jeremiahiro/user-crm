/**
 * POST /api/members/:id/avatar
 * Accepts multipart/form-data with a `photo` file field.
 * Uploads to Supabase Storage, updates people.profile_photo_url.
 */
import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'
import { isAdmin } from '@/lib/rbac'

const BUCKET = 'org-assets'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const admin = isAdmin(locals.user)
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const personId = params.id ?? ''
  if (!personId) {
    return new Response(JSON.stringify({ error: 'Missing member id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Parse multipart form
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid multipart body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const file = formData.get('photo')
  if (!(file instanceof File) || file.size === 0) {
    return new Response(JSON.stringify({ error: 'No photo file provided' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!ALLOWED_MIME.includes(file.type)) {
    return new Response(JSON.stringify({ error: 'Only JPEG, PNG, and WebP images are supported' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (file.size > MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'Image must be 5 MB or smaller' }), {
      status: 422, headers: { 'Content-Type': 'application/json' },
    })
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const storagePath = `members/${personId}/avatar.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  // Ensure bucket exists (idempotent)
  const { error: bucketError } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 5242880,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
  })
  // Ignore 'already exists' error
  if (bucketError && !bucketError.message.includes('already exists')) {
    console.error('[avatar] bucket error:', bucketError)
  }

  // Upload (upsert overwrites existing avatar)
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadError) {
    console.error('[POST /api/members/:id/avatar] upload error:', uploadError)
    return new Response(JSON.stringify({ error: 'Failed to upload image' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath)
  const publicUrl = urlData.publicUrl

  // Save URL to member record
  const { error: updateError } = await supabaseAdmin
    .from('people')
    .update({ profile_photo_url: publicUrl })
    .eq('id', personId)

  if (updateError) {
    console.error('[POST /api/members/:id/avatar] db update error:', updateError)
    return new Response(JSON.stringify({ error: 'Upload succeeded but failed to save URL' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'people',
    targetId: personId,
    afterValue: { profile_photo_url: publicUrl },
  })

  return new Response(JSON.stringify({ ok: true, url: publicUrl }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
