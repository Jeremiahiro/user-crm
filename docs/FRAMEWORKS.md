# 100BMOL Member Portal — Framework & Tech Stack

## Overview

| Layer | Technology |
|---|---|
| Frontend framework | Astro |
| Styling | Tailwind CSS |
| Language | TypeScript (strict) |
| Auth | Google OAuth 2.0 (via @auth/core) |
| Email | Gmail API (Google Workspace) |
| File storage | Google Drive API |
| Database | Supabase (PostgreSQL) |
| Hosting | Vercel |

---

## Frontend — Astro

**Why Astro:** Content-heavy pages (member directories, dashboards, programme listings) ship zero JS by default. Interactive islands (forms, modals, live tables) opt in selectively.

**Key conventions:**
- Pages live in `src/pages/` and map directly to routes
- Components that need interactivity use `.tsx` with `client:load` or `client:idle`
- Static pages (marketing, public-facing programme info) render at build time
- Authenticated dashboard pages use Astro's server-side rendering (`output: 'server'` in `astro.config.ts`) so session checks happen before the page is sent

**Recommended Astro integrations:**
```ts
// astro.config.ts
import { defineConfig } from 'astro/config'
import tailwind from '@astrojs/tailwind'
import vercel from '@astrojs/vercel/serverless'

export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [tailwind()],
})
```

---

## Styling — Tailwind CSS

**Version:** Tailwind v4 (Vite-native, no `tailwind.config.js` required)

**Key conventions:**
- Design tokens (brand colours, spacing scale) defined in `src/styles/global.css` using `@theme`
- Component variants use `class-variance-authority (cva)` — keeps variant logic out of templates
- Dark mode via `class` strategy to support admin/user theme preferences
- No inline `style=` attributes — all design decisions go through Tailwind utilities

**Brand tokens (starter):**
```css
/* src/styles/global.css */
@import "tailwindcss";

@theme {
  --color-brand-navy: #1a1a2e;
  --color-brand-gold: #c9a84c;
  --color-brand-slate: #f5f5f7;
}
```

---

## TypeScript

**Strict mode is required.** No `any`. No implicit returns.

```json
// tsconfig.json
{
  "extends": "astro/tsconfigs/strictest",
  "compilerOptions": {
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

**Conventions:**
- All Supabase table shapes are generated types — never hand-written interfaces for DB rows
- Zod is used for all runtime validation (form inputs, webhook payloads, API responses)
- `src/types/` holds shared domain types (`Member`, `Role`, `Pillar`, `Team`, etc.)

---

## Authentication — Google OAuth 2.0

The organisation runs on Google Workspace. Admins and authorised users log in with their organisational Google account. No passwords are stored.

**Library:** `@auth/core` with the Google provider (framework-agnostic, works with Astro's server adapter)

**Flow:**
1. User clicks "Sign in with Google"
2. Redirected to Google's OAuth consent screen
3. Google returns an ID token to the callback route
4. Callback verifies the token and checks the email domain or a Supabase allowlist
5. Session stored as a secure HTTP-only cookie

**Access control:**
- Domain check: only `@100bmol.org` accounts (or approved guest emails) can authenticate
- Role check: after login, the session is enriched with the user's CRM role from Supabase (`admin`, `staff`, `team_lead`, `read_only`)
- Middleware in `src/middleware.ts` protects all `/admin/*` and `/dashboard/*` routes

```ts
// src/middleware.ts (sketch)
import { defineMiddleware } from 'astro:middleware'
import { getSession } from 'auth:core'

export const onRequest = defineMiddleware(async (ctx, next) => {
  const session = await getSession(ctx.request)
  const isProtected = ctx.url.pathname.startsWith('/admin') ||
                      ctx.url.pathname.startsWith('/dashboard')

  if (isProtected && !session?.user) {
    return ctx.redirect('/login')
  }
  return next()
})
```

**Environment variables required:**
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AUTH_SECRET=           # random 32-byte string for cookie signing
```

---

## Email — Gmail API (Google Workspace)

All transactional email (welcome emails, onboarding checklist, document upload links, team lead notifications) is sent via the Gmail API using a service account or a designated sender address authorised through Google Workspace.

**Why Gmail API over SMTP:** Keeps all sent mail visible in the organisation's Google Workspace, supports threading, and avoids third-party email vendor costs.

**Library:** `googleapis` (official Google Node client)

**Sender:** A shared Workspace mailbox e.g. `membership@100bmol.org`

**Key flows:**

| Trigger | Email sent to | Template |
|---|---|---|
| Application received | Applicant | Welcome email |
| Day 2 after application | Applicant | Onboarding checklist + upload link |
| Documents complete | Admin | Review prompt |
| Member approved | Member | Approval + team lead intro |
| Member approved | Team Lead | New member profile summary |
| Term expiry approaching | Elected role holder | Re-election reminder (30 days out) |

**Email templates** live in `src/emails/` as TypeScript functions returning an HTML string. Keep them simple — inline styles only, no framework dependencies.

**Environment variables required:**
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_KEY=     # base64-encoded private key JSON
GMAIL_SENDER_ADDRESS=membership@100bmol.org
```

---

## File Storage — Google Drive API

Member documents (DBS certificates, Photo ID, passports) are stored in a structured Google Drive folder owned by the organisation. The CRM stores only the Drive file URL and metadata — not the file itself.

**Folder structure:**
```
100BMOL CRM/
  Members/
    {Member Full Name} — {Member ID}/
      DBS Certificate.pdf
      Photo ID.pdf
      Passport.pdf
  Staff/
    {Staff Name}/
      Contract.pdf
```

**Access:** The service account has editor access to the CRM root folder. Members upload via a tokenised endpoint — the server handles the Drive API call on their behalf.

**Environment variables required:**
```
GOOGLE_DRIVE_ROOT_FOLDER_ID=
```

---

## Database — Supabase

Supabase provides a managed PostgreSQL database with a typed client, row-level security, and real-time subscriptions if needed later.

**Why Supabase over a raw Postgres host:**
- Built-in Row Level Security (RLS) to enforce role-based data access at the DB layer
- Auto-generated TypeScript types from the schema (`supabase gen types typescript`)
- Storage and Edge Functions available if scope expands
- Generous free tier; scales predictably

**Client setup:**
```ts
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase.gen'

export const supabase = createClient<Database>(
  import.meta.env.SUPABASE_URL,
  import.meta.env.SUPABASE_ANON_KEY,
)

// Server-side only — bypasses RLS for admin operations
export const supabaseAdmin = createClient<Database>(
  import.meta.env.SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
)
```

**Core tables (initial schema):**

| Table | Purpose |
|---|---|
| `people` | Central person record (all roles share one profile) |
| `roles` | Role definitions (`member`, `staff`, `team_lead`, `trustee`, etc.) |
| `person_roles` | Join: person ↔ role, with `role_type` (`staff` or `elected`), `start_date`, `end_date` |
| `pillars` | Pillar definitions |
| `teams` | Teams within pillars, with `team_lead_id` FK |
| `person_teams` | Join: person ↔ team |
| `documents` | Document metadata (type, Drive URL, upload status, matched person) |
| `comms_log` | Record of every email sent (template, recipient, timestamp, status) |

**Row Level Security:** All authenticated CRM users can read `people`. Only `admin` and `staff` roles can write. `team_lead` role can read their own team's records only.

**Environment variables required:**
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## Hosting — Vercel

Astro's server adapter for Vercel deploys SSR pages as Vercel Serverless Functions and static assets to Vercel's CDN automatically.

**Key settings:**
- Framework preset: Astro (auto-detected)
- Node.js version: 20.x
- Build command: `astro build`
- Output directory: `dist/`
- Environment variables set in Vercel project settings (not committed to repo)

**Recommended Vercel features to enable:**
- **Preview deployments** on every PR — useful for reviewing member-facing changes before merge
- **Vercel Analytics** — lightweight, privacy-friendly usage data
- **Edge Config** — for feature flags (e.g. toggling onboarding automation on/off without a deploy)

---

## Environment Variable Summary

All secrets are stored in Vercel environment variables (Production, Preview, Development separately). A `.env.example` is committed to the repo with keys but no values.

```
# Auth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AUTH_SECRET=

# Google APIs
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_KEY=
GMAIL_SENDER_ADDRESS=
GOOGLE_DRIVE_ROOT_FOLDER_ID=

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## Recommended Additional Libraries

| Library | Purpose |
|---|---|
| `zod` | Runtime schema validation (form inputs, webhook payloads) |
| `@supabase/supabase-js` | Supabase typed client |
| `googleapis` | Gmail + Drive API |
| `@auth/core` | Google OAuth session management |
| `class-variance-authority` | Tailwind component variants |
| `date-fns` | Date formatting and term expiry calculations |
| `nanoid` | Short unique IDs for document upload tokens |

---

## Project Structure (Suggested)

```
src/
  components/       # Shared UI components (.astro + .tsx)
  emails/           # Email template functions
  layouts/          # Page layouts (auth, dashboard, public)
  lib/
    supabase.ts     # Supabase client
    google.ts       # Gmail + Drive API helpers
    auth.ts         # Session helpers
  middleware.ts     # Route protection
  pages/
    api/            # Server endpoints (webhooks, form handlers)
    admin/          # Admin-only pages
    dashboard/      # Authenticated member pages
    login.astro
    index.astro
  styles/
    global.css      # Tailwind theme tokens
  types/
    supabase.gen.ts # Auto-generated DB types
    domain.ts       # Shared domain types (Member, Role, Pillar…)
```
