/**
 * Shared utility functions used across admin pages and API routes.
 * All functions here are pure (no side effects, no DB calls) so they are
 * easy to unit-test.
 */

// ─── Time formatting ──────────────────────────────────────────────────────────

/**
 * Returns a human-readable relative time string.
 * e.g. "just now", "3 minutes ago", "2 hours ago", "4 days ago"
 */
export function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const diffMs = Date.now() - d.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  if (diffWeeks < 5) return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`
  const years = Math.floor(diffDays / 365)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

/**
 * Format a date string or Date as a localised UK date.
 * e.g. "15 Jan 2025"
 * Returns "—" if the value is null/undefined.
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Format a date as YYYY-MM-DD (for <input type="date"> value attributes).
 */
export function toInputDate(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString().slice(0, 10)
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const STATUS_VARIANT_MAP: Record<string, BadgeVariant> = {
  active: 'success',
  pending_review: 'warning',
  applicant: 'neutral',
  inactive: 'neutral',
}

/**
 * Maps a member status string to a Badge component variant.
 */
export function statusVariant(status: string): BadgeVariant {
  return STATUS_VARIANT_MAP[status] ?? 'neutral'
}

/**
 * Capitalises the first letter of a string.
 */
export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Converts snake_case to Title Case.
 * e.g. "member_of_the_year" → "Member Of The Year"
 */
export function snakeToTitle(s: string): string {
  return s
    .split('_')
    .map(word => capitalise(word))
    .join(' ')
}

// ─── Maths helpers ────────────────────────────────────────────────────────────

/**
 * Returns a rounded percentage. Returns 0 if total is 0 (avoids division by zero).
 */
export function pct(n: number, total: number): number {
  if (total === 0) return 0
  return Math.round((n / total) * 100)
}

/**
 * Clamps a number between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ─── String helpers ───────────────────────────────────────────────────────────

/**
 * Returns initials from a full name (up to 2 letters).
 * e.g. "John Doe" → "JD", "Alice" → "A"
 */
export function getInitials(name: string): string {
  return name
    .trim()
    .split(' ')
    .map(n => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * Truncates a string to maxLength, appending "…" if truncated.
 */
export function truncate(s: string, maxLength: number): string {
  if (s.length <= maxLength) return s
  return s.slice(0, maxLength - 1) + '…'
}
