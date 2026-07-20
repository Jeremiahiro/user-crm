/**
 * GET /api/auth/google-signin?callbackUrl=/dashboard
 *
 * Initiates the Google OAuth flow server-side by synthesising the POST
 * request that @auth/core expects, avoiding any browser cross-origin
 * CSRF issues when running behind a tunnel or proxy.
 */
import type { APIRoute } from 'astro'
import { Auth, skipCSRFCheck } from '@auth/core'
import { authConfig } from '../../../lib/auth'

export const GET: APIRoute = async ({ request, url }) => {
  const callbackUrl = url.searchParams.get('callbackUrl') ?? '/dashboard'

  const signinUrl = new URL('/api/auth/signin/google', url.origin)
  const body = new URLSearchParams({ callbackUrl })

  // Cloudflared terminates TLS and forwards requests as HTTP internally.
  // Read x-forwarded-proto from the incoming request so the callback URL
  // is built with https:// rather than http://.
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host

  const syntheticReq = new Request(signinUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: request.headers.get('cookie') ?? '',
      host,
      'x-forwarded-host': host,
      'x-forwarded-proto': proto,
    },
    body: body.toString(),
  })

  return Auth(syntheticReq, { ...authConfig, skipCSRFCheck })
}
