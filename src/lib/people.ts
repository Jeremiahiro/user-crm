import { z } from 'zod'

/** Membership type stored on people.person_types. Not the system role named Member. */
export const PERSON_TYPES = ['member', 'mentor', 'volunteer', 'parent', 'trustee'] as const

/**
 * Values allowed by people_status_check after 004_onboarding_overhaul.sql.
 * `approved` remains in the constraint (006 moved existing rows to active
 * but did not drop the value). `pending_review` was removed.
 */
export const PERSON_STATUSES = [
  'applicant',
  'in_progress',
  'in_training',
  'approved',
  'active',
  'suspended',
  'inactive',
  'alumni',
  'left',
  'cancelled',
] as const

export type PersonStatusValue = (typeof PERSON_STATUSES)[number]

/** Statuses offered on create / edit / import forms. `approved` is legacy-only. */
export const PERSON_STATUS_OPTIONS: { value: PersonStatusValue; label: string }[] = [
  { value: 'applicant', label: 'Applicant' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_training', label: 'In Training' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'alumni', label: 'Alumni' },
  { value: 'left', label: 'Left' },
  { value: 'cancelled', label: 'Cancelled' },
]

const personTypeSchema = z.enum(PERSON_TYPES)
const personStatusSchema = z.enum(PERSON_STATUSES)

const preferredName = z
  .string()
  .trim()
  .max(100)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))

export const CreateMemberSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(100),
  middle_name: z.string().trim().max(100).optional().nullable(),
  last_name: z.string().trim().min(1, 'Last name is required').max(100),
  preferred_name: preferredName,
  email: z.string().trim().email('Invalid email address'),
  email_secondary: z.string().trim().email('Invalid secondary email').optional().nullable(),
  phone: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  person_types: z.array(personTypeSchema).default(['member']),
  status: personStatusSchema.default('applicant'),
  source: z.enum(['google_form', 'manual']).optional().nullable(),
  date_joined: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export const UpdateMemberSchema = z.object({
  first_name: z.string().trim().min(1).max(100).optional(),
  middle_name: z.string().trim().max(100).optional().nullable(),
  last_name: z.string().trim().min(1).max(100).optional(),
  preferred_name: preferredName,
  email: z.string().trim().email().optional(),
  email_secondary: z.string().trim().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  person_types: z.array(personTypeSchema).optional(),
  status: personStatusSchema.optional(),
  date_joined: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export const ImportMemberRowSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(100),
  middle_name: z.string().trim().max(100).optional().nullable(),
  last_name: z.string().trim().min(1, 'Last name is required').max(100),
  preferred_name: preferredName,
  email: z.string().trim().email('Invalid email'),
  phone: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  status: personStatusSchema.default('active'),
  person_types: z.array(personTypeSchema).default(['member']),
  date_joined: z.string().optional().nullable(),
  source: z.enum(['google_form', 'manual']).optional().nullable(),
  notes: z.string().optional().nullable(),
})

/** True when the person's membership types include chapter member. */
export function isChapterMember(personTypes: readonly string[] | null | undefined): boolean {
  return personTypes?.includes('member') ?? false
}
