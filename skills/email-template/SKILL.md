---
name: email-template
description: >
  Creates HTML email templates for the 100BMOL Member Portal using the project's design system
  colours and 100BMOL branding. Use this skill whenever you need to write a transactional email
  — welcome emails, onboarding checklists, approval notifications, team lead alerts, DBS expiry
  warnings, term expiry reminders, or any automated communication sent via the Gmail API.
  Trigger for requests like "write the welcome email", "create the onboarding checklist email",
  "build the approval notification template", or "I need an email for X".
---

# Email Template — 100BMOL Portal

You are writing a transactional email template for the **100 Black Men of London Member Portal**.
Templates live in `src/emails/` as TypeScript functions that return HTML strings. They are sent
via the Gmail API from `membership@100bmol.org`.

## Template function structure

```typescript
// src/emails/welcomeEmail.ts

interface WelcomeEmailData {
  memberName: string
  memberEmail: string
}

export function welcomeEmail(data: WelcomeEmailData): { subject: string; html: string } {
  const { memberName } = data

  return {
    subject: 'Welcome to 100 Black Men of London',
    html: buildEmail({
      preheader: 'Your application has been received.',
      body: `
        <p style="margin:0 0 16px">Hi ${escapeHtml(memberName)},</p>
        <p style="margin:0 0 16px">
          Thank you for applying to join 100 Black Men of London. We have received your
          application and will be in touch with next steps shortly.
        </p>
        <p style="margin:0 0 24px">
          In the meantime, if you have any questions, reply to this email and a member of
          our team will get back to you.
        </p>
      `,
      cta: {
        text: 'Learn more about 100BMOL',
        href: 'https://100bmol.org.uk',
      },
    }),
  }
}
```

## Base layout builder

Create `src/emails/_base.ts` — all templates use this:

```typescript
interface EmailOptions {
  preheader: string           // Short preview text (shown in inbox before opening)
  body: string                // Main HTML content (paragraphs, lists — no wrapper needed)
  cta?: { text: string; href: string }  // Optional primary button
}

export function buildEmail({ preheader, body, cta }: EmailOptions): string {
  const ctaBlock = cta ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px 0">
      <tr>
        <td style="border-radius:8px;background:#1A1A2E">
          <a href="${cta.href}"
             style="display:inline-block;padding:12px 24px;font-family:Inter,Arial,sans-serif;
                    font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;
                    border-radius:8px">
            ${cta.text}
          </a>
        </td>
      </tr>
    </table>
  ` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>100 Black Men of London</title>
</head>
<body style="margin:0;padding:0;background:#F8F8FC;font-family:Inter,Arial,sans-serif">

  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">
    ${escapeHtml(preheader)}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#F8F8FC;padding:32px 16px">
    <tr>
      <td align="center">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;
                      border:1.5px solid #B0B0C0;overflow:hidden">

          <!-- Header -->
          <tr>
            <td style="background:#1A1A2E;padding:24px 32px">
              <p style="margin:0;font-family:Inter,Arial,sans-serif;font-size:18px;
                         font-weight:700;color:#ffffff;letter-spacing:-0.3px">
                100BM<span style="color:#C9A84C">OL</span>
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;font-size:15px;line-height:1.6;color:#111118">
              ${body}
              ${ctaBlock}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #F0F0F5;
                        font-size:12px;color:#6B6B80;line-height:1.5">
              <p style="margin:0">
                100 Black Men of London · Registered Charity<br>
                This email was sent to you because you are a member or applicant.
                If you received this in error, please ignore it.
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

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
```

## All 7 templates needed

| Template | File | Recipient | Trigger |
|---|---|---|---|
| Welcome | `welcomeEmail.ts` | New member | Profile created |
| Onboarding checklist | `onboardingChecklistEmail.ts` | Member | 48h after creation |
| Approval | `approvalEmail.ts` | Member | Status → Active |
| Team lead — new member | `teamLeadNewMemberEmail.ts` | Team lead | Member activated |
| Document unmatched | `documentMatchAlertEmail.ts` | Admin | Upload with no email match |
| DBS expiry alert | `dbsExpiryAlertEmail.ts` | Member | 60 and 30 days before expiry |
| Term expiry alert | `termExpiryAlertEmail.ts` | Elected position holder | 30 days before term end |

## Inline style rules

Emails cannot use external CSS or `<style>` blocks reliably across email clients. Every style
must be inline on the element itself. Rules:

- All `font-family` values: `Inter, Arial, sans-serif` (Inter may not load in all clients)
- Colours: use hex values directly — the design system tokens from DESIGN_SYSTEM.md
  - Navy: `#1A1A2E` · Gold: `#C9A84C` · Body text: `#111118` · Secondary: `#6B6B80`
  - Success: `#16A34A` · Warning: `#D97706` · Danger: `#DC2626`
- Spacing: inline `margin` and `padding` in px
- No flexbox or grid — use `<table>` for layout
- No border-radius above 12px (some clients ignore it)
- Always escape user data with `escapeHtml()` before interpolating into HTML

## Dynamic content

Always escape user-supplied strings. Never interpolate raw values:

```typescript
// ✓ Safe
<p>Hi ${escapeHtml(member.full_name)},</p>

// ✗ Unsafe — XSS risk in email clients that render HTML
<p>Hi ${member.full_name},</p>
```

For URLs (upload links, CTAs):
```typescript
const uploadUrl = `${process.env.PUBLIC_APP_URL}/upload/${token}`
// URLs don't need escapeHtml but do need to be validated before use
```

## Sending via Gmail API

After writing the template, wire it up in `src/lib/google.ts`:

```typescript
import { google } from 'googleapis'

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: Buffer.from(
        import.meta.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64'
      ).toString('utf-8'),
    },
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
  })

  const gmail = google.gmail({ version: 'v1', auth })
  const sender = import.meta.env.GMAIL_SENDER_ADDRESS

  const message = [
    `From: 100 Black Men of London <${sender}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\n')

  const encoded = Buffer.from(message).toString('base64url')

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  })
}
```
