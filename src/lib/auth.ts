import { Auth } from '@auth/core'
import Google from '@auth/core/providers/google'
import type { AuthConfig } from '@auth/core/types'
import { supabaseAdmin } from './supabase'
import { splitDisplayName } from './names'
import { resolveLoginIdentity } from './offices'
import type { PersonType, SessionUser } from '../types/domain'

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

      // Look up the person (or the current holder of an office mailbox), or create a stub
      const identity = await resolveLoginIdentity(user.email)

      if (!identity) {
        // No record — create a stub applicant profile, but deny login until an admin enables it.
        // full_name is generated from first_name / last_name and cannot be written.
        const { first_name, last_name } = splitDisplayName(user.name, user.email)
        const { error } = await supabaseAdmin.from('people').insert({
          first_name,
          last_name,
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

      // Existing record or occupied office — only allow if admin has enabled login
      return identity.personId !== null && identity.loginEnabled
    },

    async session({ session, token }) {
      if (!session.user?.email) return session

      // Re-resolved on every request so an office handover takes effect immediately
      const identity = await resolveLoginIdentity(session.user.email)
      if (!identity?.personId || !identity.loginEnabled) return session

      const { data: person } = await supabaseAdmin
        .from('people')
        .select('id, status, person_types, preferred_name, first_name, full_name')
        .eq('id', identity.personId)
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
        person_types: (person.person_types ?? []) as PersonType[],
        preferred_name: (person.preferred_name as string | null) ?? null,
        first_name: (person.first_name as string | null) ?? null,
        full_name: (person.full_name as string | null) ?? null,
        signed_in_via: identity.via,
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
