import { describe, it, expect } from 'vitest'
import { displayName, greetingName, splitDisplayName } from '../names'
import { isChapterMember, requiresDbs } from '../people'
import { isDevAuthBypassEnabled } from '../dev-auth'
import { dbErrorMessage, requireAdmin, requireCmpStaff } from '../http'
import type { SessionUser } from '@/types/domain'

function user(partial: Partial<SessionUser>): SessionUser {
  return {
    id: '1',
    email: 'a@example.com',
    name: 'Account Name',
    person_id: 'p1',
    roles: [],
    ...partial,
  }
}

describe('displayName', () => {
  it('prefers the preferred name', () => {
    expect(displayName({ preferred_name: 'Jay', first_name: 'Jeremiah', full_name: 'Jeremiah Hiro' })).toBe('Jay')
  })

  it('falls back to the legal full name, then the first name', () => {
    expect(displayName({ first_name: 'Jeremiah', full_name: 'Jeremiah Hiro' })).toBe('Jeremiah Hiro')
    expect(displayName({ first_name: 'Jeremiah' })).toBe('Jeremiah')
  })

  it('uses the account name only when no person name is stored', () => {
    expect(displayName({ name: 'Google User' })).toBe('Google User')
    expect(displayName(null)).toBe('')
  })
})

describe('greetingName', () => {
  it('uses the preferred name before the given name', () => {
    expect(greetingName({ preferred_name: 'Jay', first_name: 'Jeremiah', full_name: 'Jeremiah Hiro' })).toBe('Jay')
    expect(greetingName({ first_name: 'Jeremiah', full_name: 'Jeremiah Hiro' })).toBe('Jeremiah')
  })
})

describe('splitDisplayName', () => {
  it('splits a Google display name and never returns an empty last name', () => {
    expect(splitDisplayName('Ada Lovelace', 'ada@example.com')).toEqual({
      first_name: 'Ada',
      last_name: 'Lovelace',
    })
    expect(splitDisplayName('Ada', 'ada@example.com').last_name).toBe('Applicant')
  })

  it('does not write an email address into the name columns', () => {
    expect(splitDisplayName('ada@example.com', 'ada@example.com').first_name).toBe('ada')
    expect(splitDisplayName(null, 'mary.jane@example.com').first_name).toBe('mary')
  })
})

describe('isChapterMember', () => {
  it('requires the member person type, not a system role', () => {
    expect(isChapterMember(['member'])).toBe(true)
    expect(isChapterMember(['member', 'mentor'])).toBe(true)
    expect(isChapterMember(['volunteer'])).toBe(false)
    expect(isChapterMember([])).toBe(false)
    expect(isChapterMember(null)).toBe(false)
  })

  it('excludes trustees and parents from dues', () => {
    expect(isChapterMember(['trustee', 'parent'])).toBe(false)
  })
})

describe('requiresDbs', () => {
  it('applies to members and volunteers only', () => {
    expect(requiresDbs(['member'])).toBe(true)
    expect(requiresDbs(['volunteer'])).toBe(true)
    expect(requiresDbs(['mentor', 'volunteer'])).toBe(true)
    expect(requiresDbs(['trustee', 'parent'])).toBe(false)
    expect(requiresDbs([])).toBe(false)
    expect(requiresDbs(null)).toBe(false)
  })
})

describe('isDevAuthBypassEnabled', () => {
  const email = { devUserEmail: 'dev@example.com' }

  it('allows a local dev server only', () => {
    expect(isDevAuthBypassEnabled({ dev: true, prod: false, nodeEnv: 'development', ...email })).toBe(true)
  })

  it('stays off in production, preview, and when the email is missing', () => {
    expect(isDevAuthBypassEnabled({ dev: false, prod: true, nodeEnv: 'production', ...email })).toBe(false)
    expect(isDevAuthBypassEnabled({ dev: true, prod: false, nodeEnv: 'production', ...email })).toBe(false)
    expect(isDevAuthBypassEnabled({ dev: true, prod: false, vercelEnv: 'production', ...email })).toBe(false)
    expect(isDevAuthBypassEnabled({ dev: true, prod: false, vercelEnv: 'preview', ...email })).toBe(false)
    expect(isDevAuthBypassEnabled({ dev: true, prod: false, devUserEmail: '  ' })).toBe(false)
  })
})

describe('route guards', () => {
  it('rejects anonymous and non-admin writers', async () => {
    expect(requireAdmin(undefined)?.status).toBe(401)
    expect(requireAdmin(user({ roles: ['Member'] }))?.status).toBe(403)
    expect(requireAdmin(user({ roles: ['Chapter Leadership'] }))).toBeNull()
  })

  it('lets mentors manage CMP and keeps other members out', () => {
    expect(requireCmpStaff(user({ roles: ['Mentor'] }))).toBeNull()
    expect(requireCmpStaff(user({ person_types: ['mentor'] }))).toBeNull()
    expect(requireCmpStaff(user({ roles: ['Member'], person_types: ['member'] }))?.status).toBe(403)
  })
})

describe('dbErrorMessage', () => {
  it('includes the database message', () => {
    expect(dbErrorMessage('Failed to create session.', { message: 'column session_end_time does not exist' }))
      .toBe('Failed to create session. column session_end_time does not exist')
    expect(dbErrorMessage('Failed to create session.', null)).toBe('Failed to create session.')
  })
})
