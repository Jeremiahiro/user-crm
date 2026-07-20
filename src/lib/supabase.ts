import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY as string | undefined
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase] Missing env vars — DB queries will fail. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env',
  )
}

export const supabase = createClient(
  supabaseUrl ?? '',
  supabaseAnonKey ?? '',
)

export const supabaseAdmin = createClient(
  supabaseUrl ?? '',
  supabaseServiceKey ?? '',
)
