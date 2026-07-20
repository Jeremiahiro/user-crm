import type { APIRoute } from 'astro'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditLog } from '@/lib/audit'

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const isSuperAdmin = locals.user.roles?.includes('Super Admin') ?? false
  if (!isSuperAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden — Super Admin only' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  const formData = await request.formData()
  const file = formData.get('logo') as File | null

  if (!file || file.size === 0) {
    return new Response(JSON.stringify({ error: 'No file provided' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const maxSize = 5 * 1024 * 1024 // 5 MB
  if (file.size > maxSize) {
    return new Response(JSON.stringify({ error: 'File too large (max 5 MB)' }), {
      status: 413, headers: { 'Content-Type': 'application/json' },
    })
  }

  const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
  if (!allowed.includes(file.type)) {
    return new Response(JSON.stringify({ error: 'Invalid file type — PNG, JPG, SVG, or WebP only' }), {
      status: 415, headers: { 'Content-Type': 'application/json' },
    })
  }

  const ext = file.name.split('.').pop() ?? 'png'
  const path = `logo/org-logo.${ext}`

  // Ensure bucket exists (in case migration 009 hasn't been applied yet)
  const { data: buckets } = await supabaseAdmin.storage.listBuckets()
  const bucketExists = buckets?.some(b => b.id === 'org-assets')
  if (!bucketExists) {
    const { error: bucketErr } = await supabaseAdmin.storage.createBucket('org-assets', {
      public: true,
      fileSizeLimit: 5242880,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'],
    })
    if (bucketErr) {
      console.error('[logo upload] bucket creation error:', bucketErr)
      return new Response(JSON.stringify({ error: 'Could not create storage bucket: ' + bucketErr.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const { error: uploadError } = await supabaseAdmin.storage
    .from('org-assets')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) {
    console.error('[logo upload] storage error:', uploadError)
    return new Response(JSON.stringify({ error: 'Upload failed: ' + uploadError.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('org-assets')
    .getPublicUrl(path)

  // Cache-bust with a timestamp param
  const logoUrl = `${publicUrl}?t=${Date.now()}`

  await supabaseAdmin.from('org_settings').upsert({
    key: 'logo_url',
    value: logoUrl,
    label: 'Organisation logo URL',
    description: 'Public URL of the organisation logo shown in the portal header.',
    updated_by: locals.user.person_id,
    updated_at: new Date().toISOString(),
  })

  await writeAuditLog({
    actorId: locals.user.person_id,
    action: 'update',
    targetTable: 'org_settings',
    targetId: 'logo_url',
    afterValue: { logo_url: logoUrl },
  })

  return new Response(JSON.stringify({ data: { logo_url: logoUrl } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
