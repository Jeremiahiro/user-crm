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
│       ├── 001_schema.sql  # All tables, indexes, constraints, triggers, RLS policies
│       └── 002_seed.sql    # 5 pillars, 8 teams, 6 system roles, 5 elected positions
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

---

## Database

The schema lives in `supabase/migrations/` and is applied via the Supabase CLI:

```bash
# Push all pending migrations to your linked project
supabase db push

# Or reset and re-apply from scratch (development only)
supabase db reset
```

Migration `001_schema.sql` creates all 22 tables with indexes, check constraints, `updated_at` triggers, and RLS policies. Migration `002_seed.sql` inserts the five strategic pillars, eight default teams, six system roles, and five elected positions that every chapter instance requires.

See [docs/features/database.md](docs/features/database.md) for the full schema reference.

---

## Key Conventions

**UUID primary keys.** Every table uses `uuid primary key default gen_random_uuid()`. Never generate IDs in application code.

**Soft delete via `is_archived`.** Records are never hard-deleted. Set `is_archived = true` and exclude from queries with `eq('is_archived', false)`. Exceptions: the `roles` table uses `is_archived` too. See the archive rules in each feature doc.

**Audit every mutation.** Every `INSERT`, `UPDATE`, and soft-delete must call `writeAuditLog()` from `src/lib/audit.ts`, passing the actor's `person_id`, the action, the target table/ID, and before/after snapshots. The audit log is append-only — no update or delete is ever permitted on it.

**`supabaseAdmin` is server-side only.** The service role key bypasses Row Level Security. Import `supabaseAdmin` only inside API routes and server-side Astro page frontmatter — never in client-side components. The anon-key `supabase` client is for client-safe reads only.

**No hardcoded hex colours.** All colours are defined in `src/styles/global.css` as `@theme` CSS variables and referenced through Tailwind utilities (`text-brand-navy`, `bg-brand-gold`, etc.). See `docs/DESIGN_SYSTEM.md`.

**Strict TypeScript.** The project extends `astro/tsconfigs/strictest`. No `any`, no implicit returns, no unchecked index access. All API request bodies are parsed and validated with Zod before touching the database.

---

## Build Phases

The portal is being built across eight phases. Phases 1 and 2 are complete.

| Phase | Description | Status |
|---|---|---|
| 1 | Foundation — scaffold, Supabase schema, Google OAuth, base layouts | Complete |
| 2 | Core modules — Members, Teams, Pillars, Elected Positions, Roles & Permissions | Complete |
| 3 | Operational modules — Dues, DBS Records, Documents (Drive upload), Mentees | Pending |
| 4 | CMP — Programme years, session scheduling, attendance tracking | Pending |
| 5 | Recognition — Awards, Praise, Participation Events | Pending |
| 6 | Dashboards — role-appropriate views for Admin, Team Lead, Member | Pending |
| 7 | Email integrations — Gmail API, transactional templates, cron alerts | Pending |
| 8 | Onboarding Pipeline — public application form, 8-stage kanban | Pending |

Phases 3–7 all depend on Phase 2 being complete. Phase 8 can start after Phase 1.

Full acceptance criteria and task breakdowns are in [`docs/TASKS.md`](docs/TASKS.md).

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
