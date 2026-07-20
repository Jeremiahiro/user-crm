/**
 * seed-superadmin.mjs
 *
 * Creates or promotes a Super Admin without requiring a prior sign-in.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-superadmin.mjs \
 *     --email=you@example.com \
 *     --first-name=John \
 *     --last-name=Doe
 *
 * What it does:
 *   1. Looks up (or creates) the Supabase auth user for the email
 *   2. Upserts a row in `people` with login_enabled = true, status = 'active'
 *   3. Grants the Super Admin role
 */

import { createClient } from '@supabase/supabase-js'

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=')
      return [k, v.join('=')]
    })
)

const email     = args['email']
const firstName = args['first-name'] ?? args['firstname'] ?? ''
const lastName  = args['last-name']  ?? args['lastname']  ?? ''

if (!email) {
  console.error('\nUsage: node --env-file=.env scripts/seed-superadmin.mjs --email=you@example.com [--first-name=John] [--last-name=Doe]\n')
  process.exit(1)
}

// ── Supabase admin client ─────────────────────────────────────────────────────

const supabaseUrl        = process.env.SUPABASE_URL
const serviceRoleKey     = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.\n')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🔧  Seeding Super Admin for: ${email}\n`)

  // 1. Look up auth user, or create one
  let authUserId

  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) throw new Error('Failed to list auth users: ' + listErr.message)

  const existing = listData.users.find(u => u.email === email)

  if (existing) {
    authUserId = existing.id
    console.log(`✓  Auth user found: ${authUserId}`)
  } else {
    // Create a password-less auth user (they'll sign in via Google OAuth)
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
    })
    if (createErr) throw new Error('Failed to create auth user: ' + createErr.message)
    authUserId = created.user.id
    console.log(`✓  Auth user created: ${authUserId}`)
  }

  // 2. Resolve first/last name if not supplied
  let first = firstName
  let last  = lastName

  if (!first || !last) {
    // Try to derive from email local part (e.g. "john.doe@..." → John, Doe)
    const localPart = email.split('@')[0].replace(/[._-]/g, ' ')
    const parts = localPart.split(' ').filter(Boolean)
    if (!first) first = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : 'Admin'
    if (!last)  last  = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : 'User'
    console.log(`ℹ  Name derived from email: ${first} ${last} (pass --first-name / --last-name to override)`)
  }

  // 3. Upsert into people table
  const { data: person, error: personErr } = await supabase
    .from('people')
    .upsert(
      {
        email,
        first_name:    first,
        last_name:     last,
        status:        'active',
        login_enabled: true,
        person_types:  ['member'],
      },
      { onConflict: 'email', ignoreDuplicates: false }
    )
    .select('id, full_name')
    .single()

  if (personErr) throw new Error('Failed to upsert people row: ' + personErr.message)
  console.log(`✓  People record: ${person.full_name} (${person.id})`)

  // 4. Resolve Super Admin role
  const { data: role, error: roleErr } = await supabase
    .from('roles')
    .select('id')
    .eq('name', 'Super Admin')
    .single()

  if (roleErr || !role) throw new Error('Super Admin role not found — has 001_schema.sql been run?')

  // 5. Grant role (idempotent)
  const { error: roleGrantErr } = await supabase
    .from('user_roles')
    .upsert(
      { person_id: person.id, role_id: role.id },
      { onConflict: 'person_id,role_id', ignoreDuplicates: true }
    )

  if (roleGrantErr) throw new Error('Failed to grant role: ' + roleGrantErr.message)
  console.log(`✓  Super Admin role granted`)

  console.log(`\n🎉  Done! ${person.full_name} <${email}> is now a Super Admin.`)
  console.log(`   They can sign in at /login using Google OAuth with this email address.\n`)
}

run().catch(err => {
  console.error('\n❌ ', err.message, '\n')
  process.exit(1)
})
