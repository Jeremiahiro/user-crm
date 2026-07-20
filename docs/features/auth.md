# Authentication

## Overview

The portal uses Google OAuth 2.0 as its sole authentication mechanism, implemented via `@auth/core` with the Google provider. There are no passwords, no magic links, and no other sign-in methods. Every user signs in with a Google account, and access is controlled by whether their email exists in the `people` table and what roles they hold there.

---

## Login Page

The login page lives at `/login` and renders a single "Sign in with Google" button centred on the page. It uses `PublicLayout` — the minimal layout with no sidebar or navigation. When redirected from a protected route, the original path is preserved in a `callbackUrl` query parameter so the user lands in the right place after authentication.

---

## Authentication Flow

1. The user clicks "Sign in with Google" on `/login`.
2. `@auth/core` redirects to Google's OAuth consent screen.
3. Google redirects back to `/api/auth/[...auth]` with an authorisation code.
4. The `signIn` callback in `src/lib/auth.ts` fires:
   - It looks up the user's email in the `people` table.
   - If no record is found, it creates a stub profile with `status: 'applicant'` and `source: 'google_oauth'`, using the name and profile photo provided by Google. If that insert fails, sign-in is rejected (`return false`).
   - If a record is found (regardless of status), sign-in is permitted.
5. The `session` callback enriches the session object:
   - Fetches the person's `id` and `status` from `people`.
   - Fetches all role names from `user_roles` joined to `roles`.
   - Assembles a `SessionUser` object: `{ id, email, name, image?, person_id, roles[] }`.
   - Attaches this as `session.crm` (accessible via `locals.user` in Astro pages after middleware processes it).
6. A secure HTTP-only session cookie is set. The user is redirected to the `callbackUrl` or `/dashboard` if no callback was specified.

---

## Session Object

The enriched session is typed as `SessionUser`:

```typescript
interface SessionUser {
  id: string         // OAuth subject ID (from the Google token)
  email: string
  name: string
  image?: string     // Google profile photo URL (if provided)
  person_id: string  // UUID from the people table
  roles: string[]    // Role names: e.g. ['Chapter Leadership', 'Team Lead']
}
```

This object is attached to `locals.user` by the middleware and is available in any server-rendered Astro page as `Astro.locals.user`. The TypeScript type for `locals` is extended in `src/env.d.ts`.

---

## Route Protection — Middleware

`src/middleware.ts` runs on every request. It checks whether the requested path starts with `/admin` or `/dashboard`, and if so, verifies that a valid session exists.

The session check works by making an internal request to `/api/auth/session` using the incoming request's cookies. If the response indicates a valid session with a `user` object, the `crm` property is extracted and attached to `ctx.locals.user`. If no valid session is found — whether because no cookie exists, the cookie has expired, or the session endpoint returned an error — the request is redirected to `/login` with the original path preserved as `callbackUrl`.

Public routes (`/`, `/login`, `/api/auth/*`, and any future public pages like `/apply`) pass through without a session check.

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `AUTH_SECRET` | Random 32-byte string used to sign session cookies. Generate with `openssl rand -base64 32`. |

These are configured in `.env` locally and in Vercel project settings for deployed environments.

---

## Business Rules

**One person record per email.** The `people.email` column has a unique constraint. If two Google accounts share an email (which Google prevents in practice), the second sign-in will find the existing record and use it.

**Stub profiles are minimal.** The auto-created profile only contains `full_name`, `email`, `profile_photo_url`, `status: 'applicant'`, and `source: 'google_oauth'`. All other fields (phone, DOB, address, person_types, etc.) are left null until an administrator completes the profile.

**Roles are read at session creation, not cached long-term.** Each time a new session is established (i.e. after cookie expiry and re-login), the current role assignments are re-read from `user_roles`. There is no background refresh mechanism — role changes take effect at the user's next login.

**No domain restriction is currently enforced.** The `signIn` callback permits any Google account whose email resolves (or can be stubbed) in the `people` table. A domain whitelist (e.g. `@100bmol.org` only) can be added to the `signIn` callback if required.
