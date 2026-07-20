import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase module before importing audit
vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { writeAuditLog } from '../audit'
import { supabaseAdmin } from '../supabase'

describe('writeAuditLog', () => {
  const insertMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue({
      insert: insertMock,
    })
  })

  it('calls supabaseAdmin.from("audit_log").insert with mapped fields', async () => {
    insertMock.mockResolvedValue({ error: null })

    await writeAuditLog({
      actorId: 'actor-uuid',
      action: 'create',
      targetTable: 'people',
      targetId: 'target-uuid',
      afterValue: { full_name: 'Alice' },
    })

    expect(supabaseAdmin.from).toHaveBeenCalledWith('audit_log')
    expect(insertMock).toHaveBeenCalledWith({
      actor_id: 'actor-uuid',
      action: 'create',
      target_table: 'people',
      target_id: 'target-uuid',
      before_value: null,
      after_value: { full_name: 'Alice' },
    })
  })

  it('sets before_value and after_value to null when not provided', async () => {
    insertMock.mockResolvedValue({ error: null })

    await writeAuditLog({
      actorId: 'actor-uuid',
      action: 'delete',
      targetTable: 'teams',
      targetId: 'team-uuid',
    })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        before_value: null,
        after_value: null,
      }),
    )
  })

  it('does NOT throw when the DB insert fails (audit failure is silent)', async () => {
    insertMock.mockResolvedValue({ error: { message: 'DB connection lost' } })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      writeAuditLog({
        actorId: 'actor-uuid',
        action: 'update',
        targetTable: 'people',
        targetId: 'target-uuid',
      }),
    ).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalledWith(
      '[AuditLog] Failed to write entry:',
      expect.objectContaining({ message: 'DB connection lost' }),
    )

    consoleSpy.mockRestore()
  })

  it('passes beforeValue when provided', async () => {
    insertMock.mockResolvedValue({ error: null })

    await writeAuditLog({
      actorId: 'a',
      action: 'update',
      targetTable: 'teams',
      targetId: 't',
      beforeValue: { name: 'Old Name' },
      afterValue: { name: 'New Name' },
    })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        before_value: { name: 'Old Name' },
        after_value: { name: 'New Name' },
      }),
    )
  })
})
