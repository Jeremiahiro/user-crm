# Supabase Setup

The portal uses Supabase for its PostgreSQL database, row-level security (RLS), and real-time subscriptions. Three env vars are required.

---

## 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **New project**
3. Fill in:
   - **Name:** `100bmol-portal` (or similar)
   - **Database password:** generate a strong password and save it — you'll need it if you ever connect directly via `psql`
   - **Region:** choose the closest to your users (e.g. `West EU (Ireland)` for London-based)
4. Click **Create new project** — provisioning takes ~2 minutes

---

## 2 — Get your API keys

Once the project is ready:

1. Go to **Project Settings → API** (left sidebar)
2. Copy the following:

| Field | Env var | Notes |
|-------|---------|-------|
| **Project URL** | `SUPABASE_URL` | e.g. `https://abcdefgh.supabase.co` |
| **anon public** key | `SUPABASE_ANON_KEY` | Safe to expose in the browser — RLS enforces access |
| **service_role secret** key | `SUPABASE_SERVICE_ROLE_KEY` | **Never expose this client-side** — bypasses RLS entirely |

```env
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> The `service_role` key is used exclusively in server-side code (`supabaseAdmin` client). All Astro API routes and server pages use this client so RLS policies don't block admin operations.

---

## 3 — Run the database migrations

The entire schema is in a single file:

| File | Contains |
|------|---------|
| `supabase/migrations/001_schema.sql` | All tables, indexes, RLS policies, seed data, and the superadmin guard trigger |

### Option A — Supabase Studio (recommended for first-time setup)

1. In your Supabase project, go to **SQL Editor** (left sidebar)
2. Click **New query**
3. Open `supabase/migrations/001_schema.sql`, copy the entire contents, paste into the query window, and click **Run**

You should see `Success. No rows returned`.

### Option B — Supabase CLI

```bash
# Install the CLI
pnpm install -g supabase

# Log in
supabase login

# Link to your project (get the project ref from the URL: supabase.com/dashboard/project/<ref>)
supabase link --project-ref abcdefgh

# Push all migrations (applies all files in supabase/migrations/ in filename order)
supabase db push
```

> **Before running `db push` on production:** make sure you understand which migrations have already been applied. The CLI tracks applied migrations via a `supabase_migrations` table it manages — if you've been applying files manually via Studio, the CLI won't know about them and may try to re-apply them. In that case, stick with Studio and run only the new file manually.

---

## 4 — Bootstrap the first Super Admin

The portal has no hardcoded admin — access is controlled by the `user_roles` table. After running the migrations you need to grant at least one person the **Super Admin** role.

**Step 1 — sign in first.** The person must sign in with Google OAuth at least once so their email exists in the `people` table. Visit `/login` and authenticate.

**Step 2 — run the bootstrap script.** Open `scripts/bootstrap-superadmin.sql`, replace `REPLACE_WITH_ADMIN_GOOGLE_EMAIL` with the admin's Google account address, then paste the whole script into **SQL Editor → New query → Run**.

```sql
-- Example (edit the email before running)
do $$
declare
  _admin_email text := 'jeremiah@example.com';
  ...
```

The script is idempotent — running it twice is safe. It prints a NOTICE confirming the grant and then SELECTs the current Super Admins so you can verify.

**The guard trigger** (`004_superadmin_guard.sql`) prevents any future DELETE on `user_roles` that would leave zero Super Admins. The database will raise:

```
ERROR: Cannot remove the last Super Admin. Assign another Super Admin first.
```

This fires at the DB level for all connections including the service-role client, so it cannot be bypassed by application code.

---

## 5 — Row-level security (RLS)

RLS is **enabled on every table** in `001_schema.sql`. The policies are designed so that:

- All reads and writes from the server (`supabaseAdmin` / service role key) **bypass RLS** — the service role always has full access
- Direct client-side access using the anon key is blocked by default unless a policy explicitly permits it
- Compliance tables (`dues`, `dbs_records`, `elected_position_tenures`, `audit_log`) have **no DELETE policy** — rows can never be removed, only superseded

You should never need to disable RLS. If a query returns empty results unexpectedly when using the anon key, check that an RLS policy covers that operation.

---

## 6 — Connecting from local development

Add your `.env` file at the project root (next to `package.json`). Astro loads it automatically in dev mode.

```bash
# Start the dev server
pnpm dev
```

Verify the connection works by navigating to `/admin/members` — if the page loads without a DB error, the Supabase credentials are correct.

---

## 7 — Supabase Studio quick reference

| Task | Location in Studio |
|------|--------------------|
| Browse table data | **Table Editor** |
| Run SQL queries | **SQL Editor** |
| View RLS policies | **Authentication → Policies** |
| Monitor DB performance | **Reports → Database** |
| View real-time logs | **Logs → Postgres** |
| Manage storage buckets | **Storage** (not used by this project) |

---

## 8 — Production checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is **only** in server-side env vars (Vercel → Settings → Environment Variables, not prefixed with `PUBLIC_`)
- [ ] RLS is enabled on all tables — verify in **Authentication → Policies**
- [ ] Database password is saved in your team's password manager
- [ ] Point-in-time recovery is enabled on the Supabase project (Pro plan feature)
- [ ] Migrations have been run against the production project (not just local)
- [ ] `scripts/bootstrap-superadmin.sql` has been run and at least one Super Admin is confirmed
