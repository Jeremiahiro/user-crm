# Google Form Membership Intake

Allows prospective members to apply via a Google Form. On submission the response is automatically pushed into the portal as a `people` record with status `applicant`, and a welcome/acknowledgement email is sent.

---

## Overview

Google Forms → Google Sheets (response destination) → Apps Script trigger → Portal API (`POST /api/intake/membership`) → `people` table

The portal exposes a lightweight intake endpoint that accepts a form submission payload, creates or updates the applicant record, and optionally fires a welcome email.

---

## Form fields

Design the Google Form to collect the following. Field names in brackets are the keys the Apps Script will send to the API.

| Form question | API key | Required | Notes |
|---|---|---|---|
| First name | *(combined into `full_name`)* | Yes | |
| Surname | *(combined into `full_name`)* | Yes | |
| Middle name | `middle_name` | No | |
| Date of birth | `date_of_birth` | No | ISO format `YYYY-MM-DD` |
| Home address | `address` | No | |
| Email address | `email` | Yes | Used as unique identifier |
| Personal email (secondary) | `email_secondary` | No | |
| Mobile number | `phone` | No | |
| Profession / occupation | `profession` | No | |
| Employer | `employer` | No | |
| LinkedIn profile | `linkedin_url` | No | |
| Twitter / X | `twitter_url` | No | |
| Instagram | `instagram_url` | No | |
| Facebook | `facebook_url` | No | |
| Why do you want to become a member or volunteer? | `why_join` | No | Long text |
| Which of the Four for the Future areas interests you most? | `pillar_interest` | No | Mentoring / Education / Economic Empowerment / Health & Wellness / Leadership |
| Which committee would you be interested in joining? | `committee_interest` | No | Finance / Fundraising / Marketing & PR / Membership |
| What skills or qualities do you bring? | `skills_qualities` | No | Long text |
| Do you consent to a DBS check? | `dbs_consent` | No | Yes/No → boolean |
| Are you willing to pay membership dues? | `dues_consent` | No | Yes/No → boolean |
| Where did you hear about us? | `referral_source` | No | Free text |

---

## API endpoint

### `POST /api/intake/membership`

**Authentication:** shared secret header (`x-intake-secret`) — set `INTAKE_SECRET` in `.env`.

**Body (JSON):**
```json
{
  "full_name": "James Smith",
  "email": "james@example.com",
  "phone": "+44 7700 900000",
  "date_of_birth": "1985-04-12",
  "profession": "Software Engineer",
  "employer": "Accenture",
  "pillar_interest": "Economic Empowerment",
  "referral_source": "Friend",
  "linkedin_url": "https://linkedin.com/in/jsmith"
}
```

**Behaviour:**
- If a `people` row with this email already exists → update fields, keep existing status
- If no row exists → insert with `status = 'applicant'`, `source = 'google_form'`
- Writes an audit log entry
- Optionally sends a welcome/acknowledgement email (controlled by `send_welcome` boolean in body, default `true`)

**Response:**
```json
{ "data": { "id": "uuid", "status": "applicant", "created": true } }
```

---

## Apps Script (Google Sheets trigger)

Paste this into **Extensions → Apps Script** in the linked Google Sheet. Replace the constants at the top.

```javascript
const PORTAL_URL = 'https://your-vercel-app.vercel.app/api/intake/membership'
const INTAKE_SECRET = 'your-secret-here' // must match INTAKE_SECRET in portal .env

function onFormSubmit(e) {
  const row = e.namedValues

  function val(key) {
    return (row[key] ?? [''])[0].trim()
  }

  function bool(key) {
    const v = val(key).toLowerCase()
    return v === 'yes' || v === 'true'
  }

  // Combine first + surname into full_name
  const firstName = val('First name')
  const surname = val('Surname')
  const fullName = [firstName, surname].filter(Boolean).join(' ')

  const payload = {
    full_name:          fullName,
    middle_name:        val('Middle name') || undefined,
    email:              val('Email address'),
    email_secondary:    val('Personal email') || undefined,
    phone:              val('Mobile number') || undefined,
    date_of_birth:      val('Date of birth') || undefined,  // YYYY-MM-DD
    address:            val('Home address') || undefined,
    profession:         val('Profession / occupation') || undefined,
    employer:           val('Employer') || undefined,
    linkedin_url:       val('LinkedIn profile') || undefined,
    twitter_url:        val('Twitter / X') || undefined,
    instagram_url:      val('Instagram') || undefined,
    facebook_url:       val('Facebook') || undefined,
    why_join:           val('Why do you want to become a member or volunteer?') || undefined,
    pillar_interest:    val('Which of the Four for the Future areas interests you most?') || undefined,
    committee_interest: val('Which committee would you be interested in joining?') || undefined,
    skills_qualities:   val('What skills or qualities do you bring?') || undefined,
    dbs_consent:        bool('Do you consent to a DBS check?'),
    dues_consent:       bool('Are you willing to pay membership dues?'),
    referral_source:    val('Where did you hear about us?') || undefined,
    send_welcome:       true,
  }

  // Remove undefined keys before sending
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-intake-secret': INTAKE_SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  }

  const res = UrlFetchApp.fetch(PORTAL_URL, options)
  Logger.log(res.getContentText())
}
```

**Setup steps:**
1. In your Google Form, go to **Responses → Link to Sheets** — this creates the linked spreadsheet
2. Open the sheet → **Extensions → Apps Script**
3. Paste the script above, update `PORTAL_URL` and `INTAKE_SECRET`
4. Click **Save**, then go to **Triggers** (clock icon on left)
5. Add trigger: function `onFormSubmit`, event source **From spreadsheet**, event type **On form submit**
6. Authorise when prompted

---

## Portal implementation steps

### 1. Add `INTAKE_SECRET` to `.env`

```env
INTAKE_SECRET=generate-a-random-string-here
```

Generate one with: `openssl rand -hex 32`

### 2. Add fields to `people` table (migration)

Some intake fields don't exist yet on `people`. Add them:

```sql
alter table people
  add column if not exists phone           text,
  add column if not exists date_of_birth   date,
  add column if not exists profession      text,
  add column if not exists employer        text,
  add column if not exists linkedin_url    text,
  add column if not exists referral_source text,
  add column if not exists intake_notes    text;
```

Add this to a new migration file: `supabase/migrations/007_intake_fields.sql`

### 3. Create `POST /api/intake/membership`

```
src/pages/api/intake/membership.ts
```

Pattern:
- Check `x-intake-secret` header matches `INTAKE_SECRET` env var → 401 if not
- Zod validate the body
- Upsert into `people` on conflict `email`
- Write audit log
- If `send_welcome` is true, call the existing welcome email function

### 4. Update `people` Zod schema / types

Add the new optional fields to the member validation schema in the API routes.

---

## Data flow diagram

```
Applicant fills Google Form
        ↓
Google Sheets (response stored)
        ↓ onFormSubmit trigger
Apps Script (formats + POSTs)
        ↓ POST /api/intake/membership
        ↓ x-intake-secret header
Portal API
  ├── Validate secret
  ├── Validate body (Zod)
  ├── Upsert people row (status: applicant)
  ├── Write audit log
  └── Send welcome email (optional)
        ↓
Supabase DB
  people table (status = applicant)
        ↓
Admin sees new applicant in /admin/members
Membership team reviews → updates status to approved/active
```

---

## Security notes

- `INTAKE_SECRET` must never be committed to git — add to `.env.example` as empty placeholder
- The endpoint should be rate-limited if exposed publicly (Vercel's built-in rate limiting or a middleware check)
- The Apps Script secret is stored in the script itself — restrict access to the Google Sheet to trusted editors only
- On Vercel, add `INTAKE_SECRET` to **Settings → Environment Variables** (not prefixed with `PUBLIC_`)

---

## Implementation order

1. Migration `007_intake_fields.sql` — new columns on `people`
2. `POST /api/intake/membership` — intake API route
3. Add `INTAKE_SECRET` to `.env` and Vercel env vars
4. Build the Google Form with correct field names
5. Link to Sheets, add Apps Script trigger
6. Test end-to-end with a form submission
7. Verify record appears in `/admin/members` with status `Applicant`
