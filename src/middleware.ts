import { defineMiddleware } from 'astro:middleware'
import { Auth } from '@auth/core'
import { authConfig } from './lib/auth'
import { isDevAuthBypassEnabled } from './lib/dev-auth'
import { resolveLoginIdentity } from './lib/offices'
import { runWithRequestContext } from './lib/request-context'
import { canManageCmp, isAdmin } from './lib/rbac'
import { supabaseAdmin } from './lib/supabase'
import type { PersonType, SessionUser } from './types/domain'

const PROTECTED_PREFIXES = ['/admin', '/dashboard', '/dues', '/notifications']

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname } = ctx.url

  // Dev auth bypass — set DEV_USER_EMAIL in .env to skip the Google OAuth flow.
  // Refuses to run when the build is production or the deploy is Vercel production/preview.
  if (isDevAuthBypassEnabled({
    dev: import.meta.env.DEV,
    prod: import.meta.env.PROD,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    devUserEmail: import.meta.env.DEV_USER_EMAIL,
  })) {
    const email = import.meta.env.DEV_USER_EMAIL as string
    const identity = await resolveLoginIdentity(email)
    const { data: person } = identity?.personId && identity.loginEnabled
      ? await supabaseAdmin
        .from('people')
        .select('id, status, person_types, preferred_name, first_name, full_name')
        .eq('id', identity.personId)
        .single()
      : { data: null }
    if (person) {
      const { data: userRoles } = await supabaseAdmin
        .from('user_roles')
        .select('roles(name)')
        .eq('person_id', person.id)
      const roles: string[] = (userRoles ?? [])
        .map((ur) => (ur as unknown as { roles: { name: string } | null }).roles?.name ?? null)
        .filter((name): name is string => name !== null)
      ctx.locals.user = {
        id: person.id,
        email,
        name: (person.full_name as string | null) ?? email,
        person_id: person.id,
        roles,
        person_types: (person.person_types ?? []) as PersonType[],
        preferred_name: (person.preferred_name as string | null) ?? null,
        first_name: (person.first_name as string | null) ?? null,
        full_name: (person.full_name as string | null) ?? null,
        signed_in_via: identity?.via ?? null,
      } satisfies SessionUser
    }
  }

  // Always try to resolve the session — API routes need locals.user too
  const sessionUrl = new URL('/api/auth/session', ctx.url.origin)
  const sessionReq = new Request(sessionUrl, {
    headers: ctx.request.headers,
  })

  let sessionData: Record<string, unknown> | null = null

  try {
    const sessionRes = await Auth(sessionReq, authConfig)
    if (sessionRes.ok) {
      const json = (await sessionRes.json()) as Record<string, unknown>
      if (json && typeof json === 'object' && 'user' in json) {
        sessionData = json
      }
    }
  } catch {
    // Session check failed — treat as unauthenticated
  }

  // Attach session user to locals so all routes (pages + API) can read it
  const crm = sessionData?.['crm'] as SessionUser | undefined
  if (crm) {
    ctx.locals.user = crm
  }

  // Redirect to login only for protected page routes, not API routes
  const isProtectedPage = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  if (isProtectedPage && !ctx.locals.user) {
    const loginUrl = new URL('/login', ctx.url.origin)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return ctx.redirect(loginUrl.toString())
  }

  // ── Role-based access control ─────────────────────────────────────────────
  const actor = ctx.locals.user
  if (actor && pathname.startsWith('/admin')) {
    const userIsAdmin = isAdmin(actor)

    if (!userIsAdmin) {
      // Paths non-admins can access. Email compose is admin-only (the send API is too).
      const nonAdminAllowed = [
        /^\/admin\/pillars$/,
        /^\/admin\/teams$/,
        /^\/admin\/teams\/[^/]+$/,
        /^\/admin\/awards$/,
        /^\/admin\/praise(\/new)?$/,
        /^\/admin\/members\/[^/]+$/,
        /^\/admin\/teams\/[^/]+\/export$/,
      ]

      const ownProfileRx = actor.person_id
        ? new RegExp(`^/admin/members/${actor.person_id}(/edit)?$`)
        : null

      const allowed =
        nonAdminAllowed.some(rx => rx.test(pathname)) ||
        (ownProfileRx ? ownProfileRx.test(pathname) : false) ||
        (canManageCmp(actor) && (pathname.startsWith('/admin/cmp') || pathname.startsWith('/admin/mentees')))

      if (!allowed) {
        return ctx.redirect('/dashboard')
      }
    }
  }

  return runWithRequestContext(
    { actorVia: ctx.locals.user?.signed_in_via?.email ?? null },
    () => next(),
  )
})
