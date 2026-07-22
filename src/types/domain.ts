export type PersonStatus =
  | 'applicant'
  | 'in_progress'
  | 'in_training'
  | 'approved'
  | 'active'
  | 'suspended'
  | 'inactive'
  | 'alumni'
  | 'left'
  | 'cancelled'

export type CancellationType =
  | 'opted_out'
  | 'training_incomplete'
  | 'eligibility'
  | 'no_response'
  | 'other'

export type PersonType =
  | 'member'
  | 'mentor'
  | 'volunteer'
  | 'alumni'
  | 'parent'
  | 'trustee'

export type DocumentType =
  | 'dbs'
  | 'photo_id'
  | 'passport'
  | 'training'
  | 'agreement'
  | 'other'

export type PermissionScope = 'all' | 'own_team' | 'own_record'

export type PermissionOperation = 'create' | 'read' | 'update' | 'delete'

export type PermissionOverrideType = 'allow' | 'deny'

export type CmpAttendanceStatus = 'present' | 'absent' | 'apology'

export type ElectedBy =
  | 'chapter_vote'
  | 'board_appointment'
  | 'co_option'

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'archive'
  | 'role_grant'
  | 'role_revoke'
  | 'tenure_create'
  | 'tenure_end'

export interface Person {
  id: string
  full_name: string
  email: string
  phone?: string
  date_of_birth?: string
  gender?: string
  address?: string
  profile_photo_url?: string
  person_types: PersonType[]
  status: PersonStatus
  source?: string
  date_joined?: string
  last_activity_at?: string
  notes?: string
  created_at: string
  updated_at: string
  is_archived: boolean
}

export interface Team {
  id: string
  name: string
  description?: string
  pillar_id?: string
  is_active: boolean
  created_at: string
}

export interface Pillar {
  id: string
  name: string
  description?: string
  display_order?: number
  is_active: boolean
  created_at: string
}

export interface Role {
  id: string
  name: string
  description?: string
  is_system_protected: boolean
  is_archived: boolean
  created_at: string
}

export interface ElectedPosition {
  id: string
  title: string
  description?: string
  order_of_precedence?: number
  linked_system_role_id?: string
  is_active: boolean
  created_at: string
}

export interface ElectedPositionTenure {
  id: string
  position_id: string
  person_id: string
  term_start: string
  term_end?: string
  elected_by: ElectedBy
  notes?: string
  created_by?: string
  created_at: string
}

export interface SessionUser {
  id: string
  email: string
  name: string
  image?: string
  person_id: string
  roles: string[]
}
