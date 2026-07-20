import { defineMiddleware } from 'astro:middleware'
import { Auth } from '@auth/core'
import { authConfig } from './lib/auth'
import type { SessionUser } from './types/domain'

const PROTECTED_PREFIXES = ['/admin', '/dashboard']

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname } = ctx.url

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
  if (isProtectedPage && !sessionData) {
    const loginUrl = new URL('/login', ctx.url.origin)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return ctx.redirect(loginUrl.toString())
  }

  // ── Role-based access control ─────────────────────────────────────────────
  if (crm && pathname.startsWith('/admin')) {
    const adminRoles = ['Super Admin', 'Admin', 'Chapter Leadership']
    const userIsAdmin = crm.roles?.some((r: string) => adminRoles.includes(r)) ?? false
    const userIsMentor = crm.roles?.some((r: string) => r === 'Mentor') ?? false

    if (!userIsAdmin) {
      // Paths non-admins can access
      const nonAdminAllowed = [
        /^\/admin\/pillars$/,
        /^\/admin\/teams$/,
        /^\/admin\/teams\/[^/]+$/,
        /^\/admin\/awards$/,
        /^\/admin\/praise(\/new)?$/,
        /^\/admin\/members\/[^/]+$/,
        /^\/admin\/teams\/[^/]+\/export$/,
        /^\/admin\/email\/compose$/,
      ]

      const ownProfileRx = crm.person_id
        ? new RegExp(`^/admin/members/${crm.person_id}(/edit)?$`)
        : null

      const allowed =
        nonAdminAllowed.some(rx => rx.test(pathname)) ||
        (ownProfileRx ? ownProfileRx.test(pathname) : false) ||
        (userIsMentor && (pathname.startsWith('/admin/cmp') || pathname.startsWith('/admin/mentees')))

      if (!allowed) {
        return ctx.redirect('/dashboard')
      }
    }
  }

  return next()
})
