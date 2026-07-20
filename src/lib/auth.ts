import { Auth } from '@auth/core'
import Google from '@auth/core/providers/google'
import type { AuthConfig } from '@auth/core/types'
import { supabaseAdmin } from './supabase'
import type { SessionUser } from '../types/domain'

export const authConfig: AuthConfig = {
  providers: [
    Google({
      clientId: import.meta.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: import.meta.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  secret: import.meta.env.AUTH_SECRET ?? '',
  trustHost: true,
  basePath: '/api/auth',
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false

      // Look up or create person record
      const { data: existing } = await supabaseAdmin
        .from('people')
        .select('id, status, login_enabled')
        .eq('email', user.email)
        .single()

      if (!existing) {
        // No record — create a stub applicant profile, but deny login until an admin enables it
        const { error } = await supabaseAdmin.from('people').insert({
          full_name: user.name ?? user.email,
          email: user.email,
          profile_photo_url: user.image ?? null,
          status: 'applicant',
          source: 'google_oauth',
          login_enabled: false,
        })
        if (error) {
          console.error('[Auth] Failed to create stub profile:', error)
        }
        // Block access — admin must enable login
        return false
      }

      // Existing record — only allow if admin has enabled login
      if (!existing.login_enabled) {
        return false
      }

      return true
    },

    async session({ session, token }) {
      if (!session.user?.email) return session

      const { data: person } = await supabaseAdmin
        .from('people')
        .select('id, status')
        .eq('email', session.user.email)
        .single()

      if (!person) return session

      const { data: userRoles } = await supabaseAdmin
        .from('user_roles')
        .select('roles(name)')
        .eq('person_id', person.id)

      const roles: string[] = (userRoles ?? [])
        .map((ur) => {
          const raw = (ur as unknown as { roles: { name: string } | null })
          return raw.roles?.name ?? null
        })
        .filter((name): name is string => name !== null)

      const imageVal = session.user.image
      const enriched: SessionUser = {
        id: token.sub ?? '',
        email: session.user.email,
        name: session.user.name ?? session.user.email,
        ...(imageVal ? { image: imageVal } : {}),
        person_id: person.id as string,
        roles,
      }

      // Attach CRM session data — cast through unknown to satisfy strict typing
      ;(session as unknown as Record<string, unknown>)['crm'] = enriched

      return session
    },

    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id ?? user.email ?? ''
      }
      return token
    },
  },
}

export { Auth }
