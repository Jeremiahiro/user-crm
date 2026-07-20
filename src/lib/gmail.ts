/**
 * Gmail API client using a service account with domain-wide delegation.
 *
 * The service account impersonates GMAIL_SENDER_ADDRESS so that emails
 * appear in the organisation's sent folder. Domain-wide delegation must
 * be configured in Google Workspace Admin before this will work.
 *
 * See docs/setup/google-credentials.md for setup instructions.
 *
 * Server-side only — never import in client-side code.
 */

import { google } from 'googleapis'

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * GOOGLE_SERVICE_ACCOUNT_KEY may be stored as:
 *   a) The full service-account JSON blob (downloaded from GCP Console), or
 *   b) Just the private_key string (PEM) with literal \n characters.
 *
 * We try JSON.parse first; if that succeeds we extract the fields directly.
 * Otherwise we treat the raw value as the PEM private key.
 */
function getServiceAccountCredentials(): { email: string; key: string } {
  const raw = (import.meta.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? '').trim()
  try {
    const json = JSON.parse(raw) as { client_email?: string; private_key?: string }
    return {
      email: json.client_email ?? import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
      key: (json.private_key ?? '').replace(/\\n/g, '\n'),
    }
  } catch {
    // Not JSON — treat as raw PEM key
    return {
      email: import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
      key: raw.replace(/\\n/g, '\n'),
    }
  }
}

/**
 * Build a JWT auth client that impersonates the sender address.
 * Requires domain-wide delegation enabled in Google Workspace Admin.
 */
function getGmailAuth() {
  const { email, key } = getServiceAccountCredentials()
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: import.meta.env.GMAIL_SENDER_ADDRESS ?? '',
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  /** HTML body — must be a complete HTML document or well-formed fragment */
  html: string
  /** Optional plain-text fallback (auto-generated from html if omitted) */
  text?: string
  /** CC recipients */
  cc?: string | string[]
  /** Reply-To address (defaults to sender) */
  replyTo?: string
}

export interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
}

// ─── Dev intercept ────────────────────────────────────────────────────────────

/**
 * In dev mode (DEV_EMAIL_INTERCEPT=true), all outgoing emails are redirected
 * to DEV_EMAIL_INTERCEPT_TO so broadcast tests don't hit real members.
 * The original recipients are listed in the subject and body for visibility.
 */
function applyDevIntercept(options: SendEmailOptions): SendEmailOptions {
  const intercept = import.meta.env.DEV_EMAIL_INTERCEPT === 'true'
  const interceptTo = (import.meta.env.DEV_EMAIL_INTERCEPT_TO ?? '').trim()
  if (!intercept || !interceptTo) return options

  const originalTo = Array.isArray(options.to) ? options.to.join(', ') : options.to
  const originalCc = options.cc
    ? (Array.isArray(options.cc) ? options.cc.join(', ') : options.cc)
    : null

  const devBanner = [
    `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:12px 16px;margin-bottom:20px;font-family:sans-serif;font-size:13px;">`,
    `<strong>⚠ DEV INTERCEPT</strong> — this email was redirected from production recipients.<br>`,
    `<strong>Intended To:</strong> ${originalTo}`,
    originalCc ? `<br><strong>Intended Cc:</strong> ${originalCc}` : '',
    `</div>`,
  ].join('')

  return {
    ...options,
    to: interceptTo,
    cc: undefined,
    subject: `[DEV] ${options.subject}`,
    html: devBanner + options.html,
    text: `[DEV INTERCEPT — intended for: ${originalTo}]\n\n${options.text ?? ''}`,
  }
}

// ─── Send ─────────────────────────────────────────────────────────────────────

/**
 * Send an email via the Gmail API.
 * Returns a result object — never throws, so callers don't need try/catch.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const intercepted = applyDevIntercept(options)
  const { to, subject, html, text, cc, replyTo } = intercepted

  const sender = import.meta.env.GMAIL_SENDER_ADDRESS ?? ''
  const toList = Array.isArray(to) ? to.join(', ') : to

  const headers: string[] = [
    `From: 100 Black Men of London <${sender}>`,
    `To: ${toList}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="__BMOL_BOUNDARY__"',
  ]

  if (cc) {
    const ccList = Array.isArray(cc) ? cc.join(', ') : cc
    headers.push(`Cc: ${ccList}`)
  }
  if (replyTo) {
    headers.push(`Reply-To: ${replyTo}`)
  }

  const plainText = text ?? stripHtml(html)

  const body = [
    ...headers,
    '',
    '--__BMOL_BOUNDARY__',
    'Content-Type: text/plain; charset=utf-8',
    '',
    plainText,
    '',
    '--__BMOL_BOUNDARY__',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '',
    '--__BMOL_BOUNDARY__--',
  ].join('\r\n')

  const encoded = Buffer.from(body).toString('base64url')

  try {
    const auth = getGmailAuth()
    const gmail = google.gmail({ version: 'v1', auth })

    const { data } = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    })

    const result: SendEmailResult = { success: true }
    if (data.id) result.messageId = data.id
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Gmail] Send failed:', message)
    return { success: false, error: message }
  }
}

/**
 * Send the same email to multiple recipients individually (no BCC list visible).
 * In dev mode (DEV_EMAIL_INTERCEPT=true), collapses all sends into a single
 * digest email to DEV_EMAIL_INTERCEPT_TO instead of firing N real sends.
 * Returns an array of results, one per recipient.
 */
export async function sendEmailBulk(
  recipients: { to: string; subject: string; html: string; text?: string }[],
): Promise<{ to: string; success: boolean; error?: string }[]> {
  if (!recipients.length) return []

  const intercept = import.meta.env.DEV_EMAIL_INTERCEPT === 'true'
  const interceptTo = (import.meta.env.DEV_EMAIL_INTERCEPT_TO ?? '').trim()

  if (intercept && interceptTo) {
    // Collapse into one digest email
    const subject = recipients[0]?.subject ?? '(no subject)'
    const recipientList = recipients.map(r => `<li>${r.to}</li>`).join('')
    const digestHtml = [
      `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:12px 16px;margin-bottom:20px;font-family:sans-serif;font-size:13px;">`,
      `<strong>⚠ DEV INTERCEPT — bulk send digest</strong><br>`,
      `${recipients.length} email(s) would have been sent individually. Showing first message below.<br>`,
      `<strong>Intended recipients:</strong><ul style="margin:6px 0 0;padding-left:20px;">${recipientList}</ul>`,
      `</div>`,
      recipients[0]?.html ?? '',
    ].join('')

    const result = await sendEmail({
      to: interceptTo,
      subject: `[DEV BULK ×${recipients.length}] ${subject}`,
      html: digestHtml,
    })

    // Return synthetic success for every intended recipient
    return recipients.map(r => ({ to: r.to, success: result.success, error: result.error }))
  }

  const results = await Promise.allSettled(
    recipients.map(async (r) => {
      const result = await sendEmail(r)
      return { to: r.to, ...result }
    }),
  )
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    return { to: recipients[i]?.to ?? '', success: false, error: String(r.reason) }
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Very simple HTML → plain text converter for email fallbacks.
 * Not a full parser — strips tags and decodes common entities.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
