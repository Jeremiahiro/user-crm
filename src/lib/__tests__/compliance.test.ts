import { describe, it, expect } from 'vitest'
import { classifyDbs, summariseDbs, calcDuesCompliance } from '../compliance'
import type { DbsRecord, DuesRecord } from '../compliance'

// Fixed reference date used in all DBS tests
const REF = new Date('2025-06-15T00:00:00Z')

// ─── classifyDbs ─────────────────────────────────────────────────────────────

describe('classifyDbs', () => {
  it('returns "missing" for null expiry', () => {
    expect(classifyDbs(null, REF)).toBe('missing')
  })

  it('returns "missing" for undefined expiry', () => {
    expect(classifyDbs(undefined, REF)).toBe('missing')
  })

  it('returns "missing" for an invalid date string', () => {
    expect(classifyDbs('not-a-date', REF)).toBe('missing')
  })

  it('returns "expired" when expiry is in the past', () => {
    expect(classifyDbs('2025-01-01', REF)).toBe('expired')
  })

  it('returns "expired" for yesterday', () => {
    expect(classifyDbs('2025-06-14', REF)).toBe('expired')
  })

  it('returns "expiring_soon" within warn window (default 60 days)', () => {
    expect(classifyDbs('2025-07-01', REF)).toBe('expiring_soon')  // 16 days away
    expect(classifyDbs('2025-08-13', REF)).toBe('expiring_soon')  // 59 days away
  })

  it('returns "valid" just outside warn window', () => {
    // 61 days away from REF
    expect(classifyDbs('2025-08-15', REF)).toBe('valid')
  })

  it('returns "valid" for a far-future expiry', () => {
    expect(classifyDbs('2030-01-01', REF)).toBe('valid')
  })

  it('respects custom warnDays', () => {
    // 30-day warn window
    expect(classifyDbs('2025-07-01', REF, 30)).toBe('expiring_soon') // 16 days away
    expect(classifyDbs('2025-08-01', REF, 30)).toBe('valid')         // 47 days away
  })
})

// ─── summariseDbs ────────────────────────────────────────────────────────────

describe('summariseDbs', () => {
  const records: DbsRecord[] = [
    { person_id: 'a', expiry_date: '2030-01-01' },      // valid
    { person_id: 'b', expiry_date: '2025-07-01' },      // expiring soon (16d)
    { person_id: 'c', expiry_date: '2024-01-01' },      // expired
    { person_id: 'd', expiry_date: null },              // missing (null)
  ]
  const memberIds = ['a', 'b', 'c', 'd', 'e'] // e has no record → missing

  it('correctly counts all four statuses', () => {
    const result = summariseDbs(records, memberIds, REF)
    expect(result.valid).toBe(1)
    expect(result.expiring_soon).toBe(1)
    expect(result.expired).toBe(1)
    expect(result.missing).toBe(2) // d (null expiry) + e (no record)
  })

  it('returns all zeros for empty member list', () => {
    const result = summariseDbs(records, [], REF)
    expect(result).toEqual({ valid: 0, expiring_soon: 0, expired: 0, missing: 0 })
  })

  it('uses latest record when a person has multiple records', () => {
    const multiRecords: DbsRecord[] = [
      { person_id: 'a', expiry_date: '2024-01-01' }, // old expired
      { person_id: 'a', expiry_date: '2030-01-01' }, // newer valid
    ]
    const result = summariseDbs(multiRecords, ['a'], REF)
    expect(result.valid).toBe(1)
    expect(result.expired).toBe(0)
  })

  it('counts member as missing when not in records at all', () => {
    const result = summariseDbs([], ['x', 'y'], REF)
    expect(result.missing).toBe(2)
  })
})

// ─── calcDuesCompliance ───────────────────────────────────────────────────────

describe('calcDuesCompliance', () => {
  const activeMembers = ['m1', 'm2', 'm3', 'm4']

  const records: DuesRecord[] = [
    { person_id: 'm1', year: 2025, paid_at: '2025-01-15T00:00:00Z' }, // paid
    { person_id: 'm2', year: 2025, paid_at: null },                    // unpaid
    { person_id: 'm3', year: 2024, paid_at: '2024-01-10T00:00:00Z' }, // paid but wrong year
    // m4 has no record at all
  ]

  it('counts only paid members for the given year', () => {
    const result = calcDuesCompliance(records, activeMembers, 2025)
    expect(result.paid).toBe(1)
    expect(result.total).toBe(4)
    expect(result.percentage).toBe(25)
  })

  it('returns 100% when all active members paid', () => {
    const allPaid: DuesRecord[] = activeMembers.map(id => ({
      person_id: id, year: 2025, paid_at: '2025-01-01T00:00:00Z',
    }))
    const result = calcDuesCompliance(allPaid, activeMembers, 2025)
    expect(result.percentage).toBe(100)
    expect(result.paid).toBe(4)
  })

  it('returns 0% when no one paid', () => {
    const result = calcDuesCompliance([], activeMembers, 2025)
    expect(result.percentage).toBe(0)
    expect(result.paid).toBe(0)
  })

  it('returns 0 when there are no active members', () => {
    const result = calcDuesCompliance(records, [], 2025)
    expect(result.total).toBe(0)
    expect(result.percentage).toBe(0)
  })

  it('excludes members not in the active list even if they have dues records', () => {
    const extraRecords: DuesRecord[] = [
      { person_id: 'former-member', year: 2025, paid_at: '2025-01-01T00:00:00Z' },
      ...records,
    ]
    const result = calcDuesCompliance(extraRecords, activeMembers, 2025)
    expect(result.paid).toBe(1) // only m1 is active and paid
  })

  it('rounds percentage correctly', () => {
    // 1 out of 3 = 33.33... → rounds to 33
    const result = calcDuesCompliance(
      [{ person_id: 'm1', year: 2025, paid_at: '2025-01-01T00:00:00Z' }],
      ['m1', 'm2', 'm3'],
      2025,
    )
    expect(result.percentage).toBe(33)
  })
})
