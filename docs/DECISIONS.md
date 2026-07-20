# 100BMOL Member Portal — Decisions Log

Captures resolved questions from PRD v1.3 open questions and other design decisions made during planning.

---

## PRD Open Questions — Resolved

### Q1 — Role deletion
**Decision:** Roles can be created freely. A role that has ever been assigned to a user cannot be deleted — it can only be archived (hidden from the UI, no new assignments). Archived roles are retained for audit purposes.
**Impact:** `roles` table needs an `is_archived` flag. UI shows "Archive" not "Delete" once a role has been used.

---

### Q2 — Elected positions and system role auto-grant
**Decision:** The President position is linked to the Super Admin system role. When a tenure is created for President, the member is automatically granted Super Admin. When that tenure ends, Super Admin is revoked (unless they hold it through another means).
**Impact:** `elected_positions.linked_system_role_id` will be set for President at seed time. Auto-grant/revoke logic applies.

---

### Q4 — Custom roles beyond the 6 defaults
**Decision:** Same rule as Q1 — full CRUD on role definitions. Cannot delete a role once assigned; archive instead. Admins can create and configure custom roles (e.g. CMP Lead, Finance Lead, Membership Secretary) with any combination of module permissions.
**Impact:** No hard-coded role list in code — roles are data, not enums. Default roles seeded at launch; all configurable thereafter.

---

### Q5 — Dues tracking
**Decision:** The system does **not** process or collect payments. Dues are tracked manually — a record that a member has paid for a given month/year. Structure:
- Select a **year** (e.g. 2025, 2026)
- Within that year, **check off months** (Jan–Dec) as paid
- Annual payers: all 12 months auto-checked on entry
- Volunteers: exempt (dues section not shown or shown as N/A)

Finance Lead and Admin can update dues records. No financial data (card numbers, bank details) is stored.
**Impact:** Dues UI is a year-selector + month checklist, not a payment form. `dues` table stores `(member_id, year, month, paid_at, recorded_by)`.

---

### Q13 — Roles & permissions granularity (who can do what)
**Decision:** Defer detailed per-role CRUD scoping for now. Build the system with Super Admin and a general authenticated user role initially. Fine-tune role permissions once the core modules are stable and the team can see what the UI actually does.
**Impact:** Phase 1 build focuses on functionality, not permission enforcement. Permission matrix is implemented but not locked down until UAT.

---

## Framework Decisions

### Frontend
**Decision:** Astro (overrides PRD section 10 which suggested Next.js).
**Rationale:** Better fit for content-heavy, mostly-static portal pages with selective interactivity. PRD section 10 to be updated.

### Email
**Decision:** Gmail API via Google Workspace service account, not Resend (which PRD section 10 suggested).
**Rationale:** Organisation is fully on Google. All sent mail stays visible in the Workspace account. No third-party email vendor.

### Auth
**Decision:** Google OAuth 2.0 via `@auth/core`. Google Workspace accounts only (domain-restricted). No email/password auth.

---

## Structural Decisions

### Role immutability
Once a role has been assigned to at least one user, it becomes immutable in name and cannot be deleted. It can be archived. This preserves audit log integrity — log entries reference role names and IDs that must remain resolvable.

### Dues are a checklist, not a ledger
The dues module is a participation record, not an accounting system. No amounts, no payment methods, no receipts. Just: did this person pay for this month?

### Elected positions are separate from system roles
A member can simultaneously hold an elected position, belong to operational teams, and have a system role. These are three independent dimensions on their profile. The only link is the optional auto-grant on elected positions (e.g. President → Super Admin).
