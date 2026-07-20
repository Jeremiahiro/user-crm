import { supabaseAdmin } from './supabase'

interface NotifyOptions {
  recipientId: string
  type: string
  title: string
  body?: string
  link?: string
  data?: Record<string, unknown>
}

export async function createNotification(opts: NotifyOptions): Promise<void> {
  await supabaseAdmin.from('notifications').insert({
    recipient_id: opts.recipientId,
    type: opts.type,
    title: opts.title,
    body: opts.body ?? null,
    link: opts.link ?? null,
    data: opts.data ?? null,
  })
}

export async function notifyMultiple(recipientIds: string[], opts: Omit<NotifyOptions, 'recipientId'>): Promise<void> {
  if (recipientIds.length === 0) return
  await supabaseAdmin.from('notifications').insert(
    recipientIds.map(id => ({
      recipient_id: id,
      type: opts.type,
      title: opts.title,
      body: opts.body ?? null,
      link: opts.link ?? null,
      data: opts.data ?? null,
    }))
  )
}
