import { supabaseAdmin } from './supabase'
import type { AuditAction } from '@/types/domain'

interface AuditEntry {
  actorId?: string | null  // null = system action (no human actor)
  action: AuditAction
  targetTable: string
  targetId?: string | null  // null when there's no single UUID target (e.g. bulk ops)
  beforeValue?: Record<string, unknown>
  afterValue?: Record<string, unknown>
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const { error } = await supabaseAdmin.from('audit_log').insert({
    actor_id: entry.actorId ?? null,
    action: entry.action,
    target_table: entry.targetTable,
    target_id: entry.targetId ?? null,
    before_value: entry.beforeValue ?? null,
    after_value: entry.afterValue ?? null,
  })

  if (error) {
    // Log but don't throw — audit failure should not break the operation
    console.error('[AuditLog] Failed to write entry:', error)
  }
}
