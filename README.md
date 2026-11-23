# 100BMOL Member Portal

The official Member CRM Portal for **100 Black Men of London** — a civic organisation dedicated to improving the quality of life for Black men, women, and youth in London through mentoring, education, health, economic empowerment, and leadership programmes.

This portal is the internal operating system for the chapter: managing the full member lifecycle from first application through active membership, tracking dues and DBS compliance, recording elected positions and committee structures, and providing role-appropriate dashboards for leaders, team leads, and members.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | [Astro](https://astro.build) — SSR mode, `output: 'server'` |
| Hosting adapter | `@astrojs/vercel` |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` (no `tailwind.config.js`) |
| Language | TypeScript — `astro/tsconfigs/strictest` |
| Database | [Supabase](https://supabase.com) — managed PostgreSQL with Row Level Security |
| Authentication | Google OAuth 2.0 via `@auth/core` |
| Email | Gmail API (Google Workspace service account) |
| File storage | Google Drive API |
| Hosting | [Vercel](https://vercel.com) |

Pages are server-rendered on every request so session checks, data fetches, and permission enforcement all happen on the server before a byte reaches the browser. Interactive components use Astro islands (`client:load`) selectively.

---

## Project Structure

```
user_crm/
├── src/
│   ├── components/
│   │   └── ui/           # Base UI components (Button, Badge, Card, Input, Avatar, EmptyState)
│   ├── emails/           # Email template functions (TypeScript → HTML string)
│   ├── layouts/
│   │   ├── DashboardLayout.astro   # Top nav + sidebar for authenticated pages
│   │   └── PublicLayout.astro      # Minimal layout for login and public pages
│   ├── lib/
│   │   ├── audit.ts      # writeAuditLog() — called on every mutation
│   │   ├── auth.ts       # @auth/core config, signIn/session callbacks
│   │   ├── people.ts     # person status values and member Zod schemas
│   │   ├── names.ts      # preferred name vs legal full name
│   │   └── supabase.ts   # supabase (anon) and supabaseAdmin (service role) clients
│   ├── middleware.ts     # Route protection — redirects unauthenticated requests
│   ├── pages/
│   │   ├── api/          # Server endpoints (REST API for all mutations)
│   │   │   ├── auth/     # OAuth callback handler
│   │   │   ├── members/
│   │   │   ├── teams/
│   │   │   ├── pillars/
│   │   │   ├── positions/
│   │   │   └── roles/
│   │   ├── admin/        # Admin-only pages (members, teams, pillars, positions, roles)
│   │   ├── dashboard/    # Member-facing dashboard
│   │   ├── login.astro
│   │   └── index.astro
│   ├── styles/
│   │   └── global.css    # Tailwind @theme block with all design tokens
│   └── types/
│       └── domain.ts     # Shared TypeScript types (Person, Team, Role, SessionUser, …)
├── supabase/
│   └── migrations/
│       ├── 001_schema.sql
│       ├── 002_dues_submissions.sql
│       ├── 003_certifications.sql
│       ├── 004_onboarding_overhaul.sql
│       ├── 005_committees.sql
│       ├── 006_remove_approved_stage.sql
│       ├── 007_member_notes.sql
│       ├── 008_cmp_session_end_time.sql
│       ├── 009_people_preferred_name.sql
│       ├── 010_rls_documents_and_training.sql
│       └── 011_seed_admin_and_mentor_roles.sql
├── docs/
│   ├── features/         # Per-feature technical documentation (this directory)
│   ├── DECISIONS.md      # Architecture and design decisions log
│   ├── DESIGN_SYSTEM.md  # Colour tokens, typography, component specs
│   ├── FRAMEWORKS.md     # Tech stack rationale and conventions
│   └── TASKS.md          # 8-phase build plan with acceptance criteria
└── .env.example
```

---

## Local Development

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) — `npm install -g pnpm` (one-time global install)
- [Supabase CLI](https://supabase.com/docs/guides/cli) — `pnpm install -g supabase`
- A Google Cloud project with OAuth credentials and a service account

### Setup

```bash
# Clone the repository
git clone <repo-url>
cd user_crm

# Copy environment variables
cp .env.example .env
# Fill in all values — see Environment Variables section below

# Install dependencies
pnpm install

# Apply the database schema (requires Supabase CLI linked to your project)
supabase db push

# Start the development server
pnpm dev
```

The dev server starts at `http://localhost:4321`.

---

## Environment Variables

All secrets live in `.env` locally and in Vercel project settings for deployed environments. Never commit real values — `.env` is gitignored.

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `AUTH_SECRET` | Random 32-byte string for session cookie signing |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email for Gmail and Drive APIs |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Base64-encoded service account private key JSON |
| `GMAIL_SENDER_ADDRESS` | The "From" address for all outbound email (e.g. `membership@100bmol.org`) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Google Drive folder ID where member documents are stored |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase public anon key (safe for client-side reads) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — server-side only, bypasses RLS |
| `PUBLIC_APP_URL` | Full app URL including scheme (e.g. `http://localhost:4321` or `https://portal.100bmol.org`) |
| `DEV_USER_EMAIL` | Local development only. Signs in as this existing person when `login_enabled` is true. Never active in production or Vercel preview. |
| `CRON_SECRET` | Bearer secret for `/api/cron/birthday-notifications` |
| `INTAKE_SECRET` | Shared secret for the public membership intake endpoint |

---

## Database

The schema lives in `supabase/migrations/` and is applied via the Supabase CLI:

```bash
# Push all pending migrations to your linked project
supabase db push

# Or reset and re-apply from scratch (development only)
supabase db reset
```

Migrations in `supabase/migrations/` are applied in filename order with `supabase db push`. Do not edit a migration that has already been applied; add a new file instead. `001_schema.sql` creates the core tables (including the seeded pillars, teams, roles, and elected positions). Later files add dues submissions, documents and training, the onboarding pipeline, committees, member notes, CMP session end times, preferred names, and row level security for the tables recreated in `003`.

`people.full_name` is generated from first, middle, and last name and is the legal name used on exports and DBS records. `people.preferred_name` is what the portal shows day to day.

See [docs/features/database.md](docs/features/database.md) for the schema notes. That document can lag the migrations.

---

## Key Conventions

**UUID primary keys.** Every table uses `uuid primary key default gen_random_uuid()`. Never generate IDs in application code.

**Soft delete via `is_archived`.** Records are never hard-deleted. Set `is_archived = true` and exclude from queries with `eq('is_archived', false)`. Exceptions: the `roles` table uses `is_archived` too. See the archive rules in each feature doc.

**Audit every mutation.** Every `INSERT`, `UPDATE`, and soft-delete must call `writeAuditLog()` from `src/lib/audit.ts`, passing the actor's `person_id`, the action, the target table/ID, and before/after snapshots. The audit log is append-only — no update or delete is ever permitted on it.

**`supabaseAdmin` is server-side only.** The service role key bypasses Row Level Security. Import `supabaseAdmin` only inside API routes and server-side Astro page frontmatter — never in client-side components. The anon-key `supabase` client is for client-safe reads only.

**No hardcoded hex colours.** All colours are defined in `src/styles/global.css` as `@theme` CSS variables and referenced through Tailwind utilities (`text-brand-navy`, `bg-brand-gold`, etc.). See `docs/DESIGN_SYSTEM.md`.

**Strict TypeScript.** The project extends `astro/tsconfigs/strictest`. No `any`, no implicit returns, no unchecked index access. All API request bodies are parsed and validated with Zod before touching the database.

---

## Shipped modules

The original eight-phase plan is out of date. The portal already includes members, teams, pillars, roles, dues, DBS, documents and trainings, mentees, CMP programme years and sessions, awards, praise, participation, dashboards, email, onboarding, committees, and member notes. Dues and the buddy assignment are for people whose membership type includes `member`, which is separate from the system role named Member.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/features/members.md`](docs/features/members.md) | Members module — lifecycle, profile tabs, API |
| [`docs/features/teams.md`](docs/features/teams.md) | Teams module — roster, leads, archive rules |
| [`docs/features/pillars.md`](docs/features/pillars.md) | Pillars module — strategic pillars, team grouping |
| [`docs/features/elected-positions.md`](docs/features/elected-positions.md) | Elected positions — tenure assignment, role auto-grant |
| [`docs/features/roles.md`](docs/features/roles.md) | Roles & permissions — permission grid, archive vs delete |
| [`docs/features/auth.md`](docs/features/auth.md) | Authentication — Google OAuth, session enrichment, middleware |
| [`docs/features/database.md`](docs/features/database.md) | Database schema — all 22 tables with columns and constraints |
| [`docs/features/audit-log.md`](docs/features/audit-log.md) | Audit logging — writeAuditLog(), actions, append-only rules |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Design and architecture decisions |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Colours, typography, component specifications |
| [`docs/FRAMEWORKS.md`](docs/FRAMEWORKS.md) | Tech stack rationale and conventions |
