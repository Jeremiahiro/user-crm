/**
 * HTML email templates for the 100BMOL Member Portal.
 *
 * All templates return a { subject, html } object ready to pass to sendEmail().
 * Design: single-column, max-width 600px, brand navy + gold, works in Gmail/Outlook.
 */

// ─── Layout wrapper ───────────────────────────────────────────────────────────

const BRAND_NAVY = '#1A1A2E'
const BRAND_GOLD = '#C9A84C'

function layout(preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>100 Black Men of London</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f7; font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing: antialiased;">

  <!-- Preheader (hidden preview text) -->
  <span style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${preheader}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f7;">
    <tr>
      <td align="center" style="padding: 32px 16px;">

        <!-- Email container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
          style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color: ${BRAND_NAVY}; padding: 28px 40px;">
              <p style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: 0.01em;">
                100 Black Men of London
              </p>
              <p style="margin: 4px 0 0; font-size: 12px; color: ${BRAND_GOLD}; text-transform: uppercase; letter-spacing: 0.08em;">
                Member Portal
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 40px 32px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f5f5f7; padding: 24px 40px; border-top: 1px solid #e5e5e5;">
              <p style="margin: 0; font-size: 12px; color: #888888; line-height: 1.6;">
                This email was sent by the 100 Black Men of London Member Portal.<br />
                If you believe you received this in error, please contact us at
                <a href="mailto:portal@100blackmenoflon.org" style="color: ${BRAND_GOLD}; text-decoration: none;">portal@100blackmenoflon.org</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function heading(text: string): string {
  return `<h1 style="margin: 0 0 24px; font-size: 22px; font-weight: 700; color: ${BRAND_NAVY}; line-height: 1.3;">${text}</h1>`
}

function para(text: string): string {
  return `<p style="margin: 0 0 16px; font-size: 15px; color: #333333; line-height: 1.7;">${text}</p>`
}

function ctaButton(label: string, href: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
    <tr>
      <td style="background-color: ${BRAND_NAVY}; border-radius: 6px;">
        <a href="${href}" target="_blank"
          style="display: inline-block; padding: 14px 28px; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 6px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

function alertBox(message: string, colour: 'gold' | 'red' = 'gold'): string {
  const bg = colour === 'gold' ? '#FDF6E3' : '#FEF2F2'
  const border = colour === 'gold' ? BRAND_GOLD : '#F87171'
  const text = colour === 'gold' ? '#92680A' : '#991B1B'
  return `<div style="background-color: ${bg}; border-left: 4px solid ${border}; border-radius: 4px; padding: 14px 16px; margin: 0 0 20px;">
  <p style="margin: 0; font-size: 14px; color: ${text}; line-height: 1.6;">${message}</p>
</div>`
}

function divider(): string {
  return `<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />`
}

// ─── Templates ────────────────────────────────────────────────────────────────

export interface EmailTemplate {
  subject: string
  html: string
}

// 1 — Welcome / account created
export function welcomeEmail(params: {
  fullName: string
  portalUrl: string
}): EmailTemplate {
  const { fullName, portalUrl } = params
  const subject = 'Welcome to the 100 Black Men of London Member Portal'
  const html = layout(
    'Your member portal account is ready.',
    `
    ${heading(`Welcome, ${fullName}!`)}
    ${para('Your account on the 100 Black Men of London Member Portal has been created.')}
    ${para('You can now sign in using your Google account to view your membership information, track your CMP participation, and stay up to date with chapter activities.')}
    ${ctaButton('Sign in to the Portal', portalUrl)}
    ${divider()}
    ${para('If you have any questions, reach out to your chapter administrator.')}
    `,
  )
  return { subject, html }
}

// 2 — DBS expiry warning
export function dbsExpiryWarningEmail(params: {
  fullName: string
  expiryDate: string
  daysUntilExpiry: number
  uploadUrl?: string
}): EmailTemplate {
  const { fullName, expiryDate, daysUntilExpiry, uploadUrl } = params
  const isUrgent = daysUntilExpiry <= 14
  const subject = isUrgent
    ? `Urgent: Your DBS certificate expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`
    : `Action required: Your DBS certificate expires on ${expiryDate}`

  const html = layout(
    `Your DBS certificate expires on ${expiryDate}.`,
    `
    ${heading('DBS Certificate Expiry Notice')}
    ${para(`Dear ${fullName},`)}
    ${isUrgent
      ? alertBox(`Your DBS certificate expires in <strong>${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}</strong> on ${expiryDate}. Please renew urgently.`, 'red')
      : alertBox(`Your DBS certificate expires on <strong>${expiryDate}</strong> (${daysUntilExpiry} days from now). Please begin your renewal soon.`)}
    ${para('A valid DBS certificate is required to continue participating in 100 Black Men of London activities, particularly those involving young people.')}
    ${para('To renew your DBS certificate, please visit the DBS website or contact your employer\'s HR department. Once renewed, please upload a copy via the portal.')}
    ${uploadUrl ? ctaButton('Upload your new DBS certificate', uploadUrl) : ''}
    ${para('If you have already renewed your certificate, please ensure a copy has been submitted through the portal so your record can be updated.')}
    ${divider()}
    ${para('For any questions about this requirement, please contact your chapter administrator.')}
    `,
  )
  return { subject, html }
}

// 3 — DBS expired
export function dbsExpiredEmail(params: {
  fullName: string
  expiryDate: string
  uploadUrl?: string
}): EmailTemplate {
  const { fullName, expiryDate, uploadUrl } = params
  const subject = 'Your DBS certificate has expired — action required'
  const html = layout(
    'Your DBS certificate has expired. Please renew as soon as possible.',
    `
    ${heading('DBS Certificate Expired')}
    ${para(`Dear ${fullName},`)}
    ${alertBox(`Your DBS certificate expired on <strong>${expiryDate}</strong> and must be renewed immediately.`, 'red')}
    ${para('Until a valid DBS certificate is on file, your ability to participate in certain chapter activities may be restricted. Please prioritise renewing your certificate.')}
    ${uploadUrl ? ctaButton('Upload your renewed DBS certificate', uploadUrl) : ''}
    ${para('Once you have renewed your certificate, please upload it via the portal link above or contact your chapter administrator directly.')}
    `,
  )
  return { subject, html }
}

// 4 — Dues reminder
export function duesReminderEmail(params: {
  fullName: string
  year: number
  portalUrl: string
}): EmailTemplate {
  const { fullName, year, portalUrl } = params
  const subject = `Membership dues reminder — ${year}`
  const html = layout(
    `Your ${year} membership dues have not yet been recorded.`,
    `
    ${heading(`${year} Membership Dues`)}
    ${para(`Dear ${fullName},`)}
    ${alertBox(`Our records show that your <strong>${year} membership dues</strong> have not yet been marked as paid.`)}
    ${para('Keeping dues up to date ensures your membership remains active and supports the chapter\'s programmes and activities.')}
    ${para('If you have already paid, please disregard this message — your record may not have been updated yet. If you haven\'t paid, please contact your chapter administrator or treasurer to arrange payment.')}
    ${ctaButton('View your membership record', portalUrl)}
    ${divider()}
    ${para('If you have any questions about your dues status, please contact the chapter treasurer.')}
    `,
  )
  return { subject, html }
}

// 5 — Document upload link
export function documentUploadLinkEmail(params: {
  fullName: string
  documentType: string
  uploadUrl: string
  expiresInDays?: number
}): EmailTemplate {
  const { fullName, documentType, uploadUrl, expiresInDays } = params
  const subject = `Upload request: ${documentType} document`
  const html = layout(
    `You have been asked to upload a ${documentType} document.`,
    `
    ${heading('Document Upload Request')}
    ${para(`Dear ${fullName},`)}
    ${para(`The 100 Black Men of London chapter administrator has requested that you upload a <strong>${documentType}</strong> document.`)}
    ${expiresInDays ? alertBox(`This upload link expires in <strong>${expiresInDays} day${expiresInDays === 1 ? '' : 's'}</strong>. Please upload your document before then.`) : ''}
    ${ctaButton('Upload your document', uploadUrl)}
    ${para('The link above is unique to you. Please do not share it with others.')}
    ${divider()}
    ${para('If you did not expect this request or have any questions, please contact your chapter administrator.')}
    `,
  )
  return { subject, html }
}

// 6 — Member approval / status change
export function memberStatusEmail(params: {
  fullName: string
  newStatus: 'approved' | 'active' | 'inactive'
  message?: string
  portalUrl: string
}): EmailTemplate {
  const { fullName, newStatus, message, portalUrl } = params

  const statusMessages: Record<typeof newStatus, { subject: string; body: string }> = {
    approved: {
      subject: 'Your membership application has been approved',
      body: 'Your membership application to 100 Black Men of London has been approved. You are now listed as an approved member.',
    },
    active: {
      subject: 'Your membership is now active',
      body: 'Your 100 Black Men of London membership has been confirmed as active.',
    },
    inactive: {
      subject: 'Your membership status has been updated',
      body: 'Your 100 Black Men of London membership has been marked as inactive. Please contact your chapter administrator if you have any questions.',
    },
  }

  const { subject, body } = statusMessages[newStatus]
  const html = layout(
    subject,
    `
    ${heading(subject)}
    ${para(`Dear ${fullName},`)}
    ${para(body)}
    ${message ? para(`<em>${message}</em>`) : ''}
    ${ctaButton('View your member profile', portalUrl)}
    `,
  )
  return { subject, html }
}
