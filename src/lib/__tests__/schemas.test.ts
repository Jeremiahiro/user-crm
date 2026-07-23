/**
 * Tests for the Zod validation schemas used in API routes.
 * Schemas are extracted here so they can be tested without spinning up
 * the Astro server.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// ─── Schemas (mirrored from API routes) ──────────────────────────────────────
// These match the schemas in src/pages/api/* exactly.
// If you change a schema in the route, update it here too.

const PERSON_STATUSES = ['applicant', 'pending_review', 'active', 'suspended', 'inactive'] as const
const PERSON_TYPES = ['member', 'mentor', 'volunteer', 'parent', 'trustee'] as const

const CreateMemberSchema = z.object({
  full_name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  date_of_birth: z.string().optional(),
  gender: z.string().optional(),
  address: z.string().optional(),
  person_types: z.array(z.enum(PERSON_TYPES)).default(['member']),
  status: z.enum(PERSON_STATUSES).default('applicant'),
  source: z.enum(['google_form', 'manual']).optional(),
  date_joined: z.string().optional(),
  notes: z.string().optional(),
})

const CreateAwardSchema = z.object({
  person_id: z.string().uuid(),
  type: z.enum([
    'member_of_the_year', 'volunteer_of_the_year', 'mentor_of_the_year',
    'rising_star', 'community_impact', 'leadership_excellence', 'special_recognition',
  ]),
  year: z.number().int().min(2000).max(2100),
  citation: z.string().optional(),
  awarded_by: z.string().uuid().optional(),
})

const CreatePraiseSchema = z.object({
  recipient_id: z.string().uuid(),
  message: z.string().min(1).max(1000),
  visibility: z.enum(['public', 'admin_only']).default('public'),
})

const CreateMenteeSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email().optional(),
  school: z.string().optional(),
  year_group: z.string().optional(),
  mentor_id: z.string().uuid().optional(),
  programme_year_id: z.string().uuid().optional(),
  guardian_name: z.string().optional(),
  guardian_email: z.string().email().optional(),
  guardian_phone: z.string().optional(),
  notes: z.string().optional(),
})

const CreateCmpYearSchema = z.object({
  name: z.string().min(1),
  start_date: z.string(),
  end_date: z.string(),
})

// ─── CreateMemberSchema ───────────────────────────────────────────────────────

describe('CreateMemberSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = CreateMemberSchema.safeParse({
      full_name: 'Alice Smith',
      email: 'alice@example.com',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('applicant')
      expect(result.data.person_types).toEqual(['member'])
    }
  })

  it('rejects an empty name', () => {
    const result = CreateMemberSchema.safeParse({
      full_name: '',
      email: 'alice@example.com',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.full_name).toBeTruthy()
    }
  })

  it('rejects an invalid email', () => {
    const result = CreateMemberSchema.safeParse({
      full_name: 'Bob',
      email: 'not-an-email',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email).toBeTruthy()
    }
  })

  it('accepts all valid statuses', () => {
    for (const status of PERSON_STATUSES) {
      const result = CreateMemberSchema.safeParse({
        full_name: 'Test',
        email: 'test@example.com',
        status,
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects an invalid status', () => {
    const result = CreateMemberSchema.safeParse({
      full_name: 'Test',
      email: 'test@example.com',
      status: 'suspended',
    })
    expect(result.success).toBe(false)
  })

  it('accepts multiple person_types', () => {
    const result = CreateMemberSchema.safeParse({
      full_name: 'Test',
      email: 'test@example.com',
      person_types: ['member', 'mentor'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a name longer than 200 characters', () => {
    const result = CreateMemberSchema.safeParse({
      full_name: 'A'.repeat(201),
      email: 'test@example.com',
    })
    expect(result.success).toBe(false)
  })
})

// ─── CreateAwardSchema ────────────────────────────────────────────────────────

describe('CreateAwardSchema', () => {
  const validId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

  it('accepts a valid award', () => {
    const result = CreateAwardSchema.safeParse({
      person_id: validId,
      type: 'member_of_the_year',
      year: 2024,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-UUID person_id', () => {
    const result = CreateAwardSchema.safeParse({
      person_id: 'not-a-uuid',
      type: 'rising_star',
      year: 2024,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown award type', () => {
    const result = CreateAwardSchema.safeParse({
      person_id: validId,
      type: 'best_dressed',
      year: 2024,
    })
    expect(result.success).toBe(false)
  })

  it('rejects year below 2000', () => {
    const result = CreateAwardSchema.safeParse({
      person_id: validId,
      type: 'rising_star',
      year: 1999,
    })
    expect(result.success).toBe(false)
  })

  it('rejects year above 2100', () => {
    const result = CreateAwardSchema.safeParse({
      person_id: validId,
      type: 'rising_star',
      year: 2101,
    })
    expect(result.success).toBe(false)
  })

  it('accepts an optional citation', () => {
    const result = CreateAwardSchema.safeParse({
      person_id: validId,
      type: 'leadership_excellence',
      year: 2024,
      citation: 'Outstanding contribution to the chapter.',
    })
    expect(result.success).toBe(true)
  })
})

// ─── CreatePraiseSchema ───────────────────────────────────────────────────────

describe('CreatePraiseSchema', () => {
  const validId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

  it('accepts a valid praise message', () => {
    const result = CreatePraiseSchema.safeParse({
      recipient_id: validId,
      message: 'Great work on the event!',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.visibility).toBe('public')
    }
  })

  it('rejects an empty message', () => {
    const result = CreatePraiseSchema.safeParse({
      recipient_id: validId,
      message: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a message over 1000 characters', () => {
    const result = CreatePraiseSchema.safeParse({
      recipient_id: validId,
      message: 'x'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  it('accepts admin_only visibility', () => {
    const result = CreatePraiseSchema.safeParse({
      recipient_id: validId,
      message: 'Internal note.',
      visibility: 'admin_only',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid visibility value', () => {
    const result = CreatePraiseSchema.safeParse({
      recipient_id: validId,
      message: 'Good job.',
      visibility: 'private',
    })
    expect(result.success).toBe(false)
  })
})

// ─── CreateMenteeSchema ───────────────────────────────────────────────────────

describe('CreateMenteeSchema', () => {
  it('accepts a minimal mentee (name only)', () => {
    const result = CreateMenteeSchema.safeParse({ full_name: 'James Brown' })
    expect(result.success).toBe(true)
  })

  it('rejects an empty name', () => {
    const result = CreateMenteeSchema.safeParse({ full_name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid guardian email', () => {
    const result = CreateMenteeSchema.safeParse({
      full_name: 'James',
      guardian_email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-UUID mentor_id', () => {
    const result = CreateMenteeSchema.safeParse({
      full_name: 'James',
      mentor_id: 'abc',
    })
    expect(result.success).toBe(false)
  })
})

// ─── CreateCmpYearSchema ──────────────────────────────────────────────────────

describe('CreateCmpYearSchema', () => {
  it('accepts a valid CMP year', () => {
    const result = CreateCmpYearSchema.safeParse({
      name: '2024-25',
      start_date: '2024-09-01',
      end_date: '2025-07-31',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty name', () => {
    const result = CreateCmpYearSchema.safeParse({
      name: '',
      start_date: '2024-09-01',
      end_date: '2025-07-31',
    })
    expect(result.success).toBe(false)
  })
})
