import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  timeAgo,
  formatDate,
  toInputDate,
  statusVariant,
  capitalise,
  snakeToTitle,
  pct,
  clamp,
  getInitials,
  truncate,
} from '../utils'

// ─── timeAgo ─────────────────────────────────────────────────────────────────

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for < 60 seconds ago', () => {
    const d = new Date('2025-06-15T11:59:30Z')
    expect(timeAgo(d)).toBe('just now')
  })

  it('returns singular minute', () => {
    expect(timeAgo(new Date('2025-06-15T11:59:00Z'))).toBe('1 minute ago')
  })

  it('returns plural minutes', () => {
    expect(timeAgo(new Date('2025-06-15T11:50:00Z'))).toBe('10 minutes ago')
  })

  it('returns singular hour', () => {
    expect(timeAgo(new Date('2025-06-15T11:00:00Z'))).toBe('1 hour ago')
  })

  it('returns plural hours', () => {
    expect(timeAgo(new Date('2025-06-15T06:00:00Z'))).toBe('6 hours ago')
  })

  it('returns singular day', () => {
    expect(timeAgo(new Date('2025-06-14T12:00:00Z'))).toBe('1 day ago')
  })

  it('returns plural days', () => {
    expect(timeAgo(new Date('2025-06-10T12:00:00Z'))).toBe('5 days ago')
  })

  it('returns weeks', () => {
    expect(timeAgo(new Date('2025-06-01T12:00:00Z'))).toBe('2 weeks ago')
  })

  it('returns months', () => {
    expect(timeAgo(new Date('2025-03-15T12:00:00Z'))).toBe('3 months ago')
  })

  it('returns years', () => {
    expect(timeAgo(new Date('2023-06-15T12:00:00Z'))).toBe('2 years ago')
  })

  it('accepts a string date', () => {
    expect(timeAgo('2025-06-15T11:59:30Z')).toBe('just now')
  })
})

// ─── formatDate ───────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats a date string to UK locale', () => {
    // We check the format components rather than exact string (locale varies by OS)
    const result = formatDate('2025-01-15')
    expect(result).toContain('2025')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
  })

  it('returns "—" for null', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('returns "—" for undefined', () => {
    expect(formatDate(undefined)).toBe('—')
  })

  it('accepts a Date object', () => {
    const result = formatDate(new Date('2025-06-01'))
    expect(result).toContain('2025')
    expect(result).toContain('Jun')
  })
})

// ─── toInputDate ──────────────────────────────────────────────────────────────

describe('toInputDate', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(toInputDate('2025-06-15T12:00:00Z')).toBe('2025-06-15')
  })

  it('returns empty string for null', () => {
    expect(toInputDate(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(toInputDate(undefined)).toBe('')
  })
})

// ─── statusVariant ────────────────────────────────────────────────────────────

describe('statusVariant', () => {
  it.each([
    ['active', 'success'],
    ['approved', 'info'],
    ['pending_review', 'warning'],
    ['applicant', 'neutral'],
    ['inactive', 'neutral'],
    ['alumni', 'neutral'],
    ['left', 'danger'],
  ])('maps %s → %s', (status, expected) => {
    expect(statusVariant(status)).toBe(expected)
  })

  it('returns "neutral" for unknown status', () => {
    expect(statusVariant('unknown_status')).toBe('neutral')
  })
})

// ─── capitalise ───────────────────────────────────────────────────────────────

describe('capitalise', () => {
  it('capitalises the first letter', () => {
    expect(capitalise('hello')).toBe('Hello')
  })

  it('does not change already-capitalised string', () => {
    expect(capitalise('World')).toBe('World')
  })

  it('handles empty string', () => {
    expect(capitalise('')).toBe('')
  })
})

// ─── snakeToTitle ─────────────────────────────────────────────────────────────

describe('snakeToTitle', () => {
  it('converts snake_case to Title Case', () => {
    expect(snakeToTitle('member_of_the_year')).toBe('Member Of The Year')
  })

  it('handles single word', () => {
    expect(snakeToTitle('active')).toBe('Active')
  })
})

// ─── pct ─────────────────────────────────────────────────────────────────────

describe('pct', () => {
  it('calculates percentage rounded to nearest integer', () => {
    expect(pct(1, 3)).toBe(33)
    expect(pct(2, 3)).toBe(67)
  })

  it('returns 100 when n === total', () => {
    expect(pct(10, 10)).toBe(100)
  })

  it('returns 0 when total is 0 (no division by zero)', () => {
    expect(pct(0, 0)).toBe(0)
    expect(pct(5, 0)).toBe(0)
  })

  it('returns 0 when n is 0', () => {
    expect(pct(0, 100)).toBe(0)
  })
})

// ─── clamp ────────────────────────────────────────────────────────────────────

describe('clamp', () => {
  it('clamps to minimum', () => {
    expect(clamp(-5, 0, 100)).toBe(0)
  })

  it('clamps to maximum', () => {
    expect(clamp(150, 0, 100)).toBe(100)
  })

  it('returns value unchanged when in range', () => {
    expect(clamp(50, 0, 100)).toBe(50)
  })

  it('returns min when value equals min', () => {
    expect(clamp(0, 0, 100)).toBe(0)
  })

  it('returns max when value equals max', () => {
    expect(clamp(100, 0, 100)).toBe(100)
  })
})

// ─── getInitials ─────────────────────────────────────────────────────────────

describe('getInitials', () => {
  it('returns two initials for a full name', () => {
    expect(getInitials('John Doe')).toBe('JD')
  })

  it('returns one initial for a single name', () => {
    expect(getInitials('Alice')).toBe('A')
  })

  it('uses only the first two words', () => {
    expect(getInitials('John Michael Doe')).toBe('JM')
  })

  it('handles extra whitespace', () => {
    expect(getInitials('  Jane   Smith  ')).toBe('JS')
  })

  it('returns uppercase', () => {
    expect(getInitials('alice bob')).toBe('AB')
  })
})

// ─── truncate ─────────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('returns string unchanged if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates and appends ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello w…')
  })

  it('returns string unchanged if exactly at limit', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })
})
