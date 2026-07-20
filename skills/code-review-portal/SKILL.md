---
name: code-review-portal
description: >
  Reviews code written for the 100BMOL Member Portal against the PRD, design system, and
  project decisions. Use this skill before marking any phase or module complete, when asked
  to review a file or diff, or after an agent has finished building a feature. Checks for
  TypeScript violations, hardcoded colours, missing audit logs, missing Zod validation,
  broken design system usage, security issues, and PRD compliance. Trigger for requests like
  "review this before I merge", "check my code", "QA the members module", "is this correct?",
  "review what the agent built", or any post-build verification request.
---

# Code Review — 100BMOL Portal

You are performing a QA review of code written for the **100 Black Men of London Member Portal**.
Your job is to catch issues before they reach production — not to rewrite everything, but to
surface specific, actionable problems with file and line references.

## Reference documents (read before reviewing)

- `docs/TASKS.md` — module specs and acceptance criteria
- `docs/DESIGN_SYSTEM.md` — colour tokens, typography, component specs
- `docs/DECISIONS.md` — resolved questions (dues structure, role immutability, etc.)
- `docs/FRAMEWORKS.md` — stack conventions

## Review checklist

Run through every file in scope against these checks. Report each finding as:
`[SEVERITY] file/path.ts:line — description — fix`

Severity levels: **BLOCKER** (must fix before merging) · **WARNING** (should fix) · **NOTE** (suggestion)

---

### 1. TypeScript (BLOCKER level)

- [ ] No `any` types — explicit interfaces or union types required
- [ ] No non-null assertions (`!`) without a preceding null check
- [ ] No `as SomeType` casts that bypass type safety
- [ ] All Supabase query results typed (not `any[]`)
- [ ] All function parameters and return types declared
- [ ] `tsconfig.json` extends `astro/tsconfigs/strictest`

---

### 2. Design system (BLOCKER level)

- [ ] No hardcoded hex colours (`#1A1A2E`, `#C9A84C`, etc.) — must use Tailwind tokens
- [ ] No hardcoded `rgb()` or `hsl()` colour values
- [ ] No inline `style="color:#..."` on elements
- [ ] Font classes used correctly: `font-heading` for headings, `font-mono` for IDs/codes
- [ ] Spacing is multiples of 4px via Tailwind utilities (no arbitrary `style="margin:15px"`)
- [ ] Border radius uses design tokens: `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-full`
- [ ] Status values always rendered via `<Badge>` component — not raw text or custom spans
- [ ] Empty states use `<EmptyState>` component — no blank sections

---

### 3. Auth & security (BLOCKER level)

- [ ] Every API route checks `locals.user` before any DB operation
- [ ] 401 returned if user is not authenticated
- [ ] Every form input validated with Zod before DB insert/update
- [ ] 422 returned with `issues` on validation failure
- [ ] User-supplied strings escaped before HTML rendering
- [ ] Upload token endpoints validate the token exists before serving content
- [ ] No secrets or env vars logged to console
- [ ] `supabaseAdmin` (service role) used only server-side — never exposed to client

---

### 4. Database & audit (BLOCKER level)

- [ ] Every mutation (create, update, archive) writes to `audit_log`
- [ ] `writeAuditLog` called after successful DB operation, not before
- [ ] `supabaseAdmin` used for all server-side writes
- [ ] No hard deletes — all removals use `is_archived = true`
- [ ] Compliance exceptions respected: DBS records, dues, audit_log, and elected tenures have no delete route
- [ ] FK lookups include `.single()` and handle the case where the record is not found
- [ ] DB errors logged with route prefix: `[POST /api/members]`

---

### 5. PRD compliance (WARNING level)

- [ ] Member archive blocked if active elected tenure exists
- [ ] Team archive blocked while active members assigned
- [ ] Pillar archive blocked if teams or members assigned
- [ ] Elected tenure has no delete route (permanent record)
- [ ] Role archive (not delete) once any user has been assigned
- [ ] Dues module shows year/month checklist — not a payment form
- [ ] Elected position tenure assignment is atomic (closes previous tenure + role auto-grant in same transaction)

---

### 6. Code quality (WARNING level)

- [ ] No `console.log` left from debugging (only `console.error` for real errors)
- [ ] No TODO comments in committed code (convert to TASKS.md entries)
- [ ] Async functions have proper error handling (try/catch or `.catch()`)
- [ ] No `setTimeout` or polling — use Supabase real-time or server-sent events if needed
- [ ] No duplicate DB queries that could be combined
- [ ] No `n+1` queries — joins done at DB level, not in JS loops

---

### 7. Astro-specific (WARNING level)

- [ ] All data fetched server-side in frontmatter — no `fetch()` in client scripts for initial data
- [ ] Dynamic routes (`[id].astro`) handle the case where the record doesn't exist (redirect or 404)
- [ ] `currentPath` passed to `DashboardLayout` so sidebar active state works
- [ ] Forms use `method="POST"` with server-side handling — no unprotected client-side submits
- [ ] Interactive components (Modal, Dropdown) use `.tsx` with `client:load` directive

---

### 8. Accessibility (NOTE level)

- [ ] All images have `alt` text
- [ ] Form inputs have associated `<label>` elements (not just placeholder)
- [ ] Icon-only buttons have `aria-label`
- [ ] Modals have `role="dialog"` and `aria-labelledby`
- [ ] Focus management: modal opens → focus moves inside; modal closes → focus returns to trigger
- [ ] Status colours always paired with text (not colour alone)

---

## Output format

Structure your review as:

```
## Review: {module or file name}

### Summary
{2–3 sentence overview — what was built, overall quality, main concerns}

### Blockers ({count})
[BLOCKER] src/pages/api/members/index.ts:23 — No Zod validation on request body — Add CreateMemberSchema.safeParse(body) before DB insert

### Warnings ({count})
[WARNING] src/pages/admin/members/index.astro:45 — Hardcoded colour #1A1A2E — Replace with text-brand-navy

### Notes ({count})
[NOTE] src/components/ui/Badge.astro:12 — Consider adding a title prop for tooltip accessibility

### Passed checks
- TypeScript strict: ✓
- Audit logging: ✓
- Empty states: ✓
```

If there are zero blockers, say so clearly: "No blockers — safe to mark complete."
If there are blockers, do not mark the phase or module as complete.
