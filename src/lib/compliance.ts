/**
 * Business logic for DBS and dues compliance calculations.
 * All functions are pure — they accept data arrays and return computed values.
 * No DB calls here; queries happen in the calling page/route.
 */

// ─── DBS ─────────────────────────────────────────────────────────────────────

export type DbsStatus = 'valid' | 'expiring_soon' | 'expired' | 'missing'

export interface DbsRecord {
  person_id: string
  expiry_date: string | null
}

export interface DbsStatusSummary {
  valid: number
  expiring_soon: number
  expired: number
  missing: number
}

/**
 * Classifies a single DBS record relative to a reference date.
 *
 * @param expiryDate - ISO date string or null
 * @param referenceDate - Date to compare against (defaults to today)
 * @param warnDays - Days before expiry to start showing "expiring soon" warning (default 60)
 */
export function classifyDbs(
  expiryDate: string | null | undefined,
  referenceDate: Date = new Date(),
  warnDays = 60,
): DbsStatus {
  if (!expiryDate) return 'missing'
  const exp = new Date(expiryDate)
  if (isNaN(exp.getTime())) return 'missing'
  if (exp < referenceDate) return 'expired'
  const warnThreshold = new Date(referenceDate)
  warnThreshold.setDate(referenceDate.getDate() + warnDays)
  if (exp < warnThreshold) return 'expiring_soon'
  return 'valid'
}

/**
 * Given a list of DBS records (one per person, already deduplicated to the
 * latest record per person), returns a summary count by status.
 *
 * Pass only active members' records.
 */
export function summariseDbs(
  records: DbsRecord[],
  memberIds: string[],
  referenceDate: Date = new Date(),
  warnDays = 60,
): DbsStatusSummary {
  const latestByPerson = new Map<string, string | null>()
  for (const rec of records) {
    const existing = latestByPerson.get(rec.person_id)
    if (existing === undefined || (rec.expiry_date && (!existing || rec.expiry_date > existing))) {
      latestByPerson.set(rec.person_id, rec.expiry_date)
    }
  }

  const summary: DbsStatusSummary = { valid: 0, expiring_soon: 0, expired: 0, missing: 0 }
  for (const memberId of memberIds) {
    const expiry = latestByPerson.get(memberId) // undefined if no record
    const status = classifyDbs(expiry ?? null, referenceDate, warnDays)
    summary[status]++
  }
  return summary
}

// ─── Dues compliance ──────────────────────────────────────────────────────────

export interface DuesRecord {
  person_id: string
  year: number
  paid_at: string | null
}

export interface DuesComplianceResult {
  paid: number
  total: number
  percentage: number
}

/**
 * Calculates dues compliance for a given year.
 *
 * A member is "compliant" if they have at least one dues record for the year
 * with a non-null paid_at, regardless of which months are covered.
 *
 * @param duesRecords - All dues records for the year in question
 * @param activeMemberIds - IDs of active members (compliance denominator)
 * @param year - The year to check (filters records by year)
 */
export function calcDuesCompliance(
  duesRecords: DuesRecord[],
  activeMemberIds: string[],
  year: number,
): DuesComplianceResult {
  const activeSet = new Set(activeMemberIds)
  const paidIds = new Set(
    duesRecords
      .filter(d => d.year === year && d.paid_at !== null && activeSet.has(d.person_id))
      .map(d => d.person_id),
  )
  const total = activeMemberIds.length
  const paid = paidIds.size
  const percentage = total === 0 ? 0 : Math.round((paid / total) * 100)
  return { paid, total, percentage }
}
