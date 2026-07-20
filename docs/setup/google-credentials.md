# Google Credentials Setup

The portal uses two distinct Google credential types:

| Credential | Used for |
|-----------|---------|
| **OAuth 2.0 Client** | Member/admin sign-in via Google account |
| **Service Account** | Server-side Gmail API (sending email) and Drive API (document storage) |

Both live in the same Google Cloud project.

---

## 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project selector (top-left) → **New Project**
3. Name it something like `100bmol-portal` → **Create**
4. Make sure the new project is selected in the project selector before continuing

---

## 2 — Enable required APIs

Navigate to **APIs & Services → Library** and enable all four:

| API | Purpose |
|-----|---------|
| **Google+ API** (or People API) | OAuth sign-in profile data |
| **Gmail API** | Sending email from the Workspace account |
| **Google Drive API** | Uploading and linking documents |
| **Admin SDK API** | (Optional) domain-wide delegation verification |

Search for each by name, click it, then click **Enable**.

---

## 3 — OAuth 2.0 Client (for sign-in)

This generates `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### 3a — Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **Internal** (restricts sign-in to your Google Workspace domain only)
3. Fill in:
   - App name: `100 Black Men of London Portal`
   - User support email: your admin email
   - Developer contact: your admin email
4. Click **Save and Continue**
5. Scopes — click **Add or Remove Scopes**, add:
   - `openid`
   - `email`
   - `profile`
6. Click **Save and Continue** through the rest

### 3b — Create the OAuth client

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `Portal web client`
4. Authorised JavaScript origins:
   - `http://localhost:4321` (dev)
   - `https://your-production-domain.vercel.app`
5. Authorised redirect URIs:
   - `http://localhost:4321/api/auth/callback/google`
   - `https://your-production-domain.vercel.app/api/auth/callback/google`
6. Click **Create**

You'll see a modal with **Client ID** and **Client Secret**. Copy both immediately.

```env
GOOGLE_CLIENT_ID=123456789-abc...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

> **`AUTH_SECRET`** — This is not from Google. Generate a random 32-byte secret for signing session tokens:
> ```bash
> openssl rand -base64 32
> ```
> Add the output as `AUTH_SECRET=` in your `.env`.

---

## 4 — Service Account (for Gmail + Drive)

The service account runs as the portal's server — it sends emails and manages Drive files without any user interaction.

### 4a — Create the service account

1. **APIs & Services → Credentials → Create Credentials → Service account**
2. Name: `portal-server`
3. Description: `Server-side Gmail and Drive access`
4. Click **Create and Continue**
5. Role: **Basic → Editor** (or leave blank — permissions are granted via delegation below)
6. Click **Done**

### 4b — Create and download the JSON key

1. In **APIs & Services → Credentials**, click your new service account
2. Go to the **Keys** tab → **Add Key → Create new key**
3. Key type: **JSON** → **Create**
4. A `.json` file downloads automatically — keep it safe, it cannot be re-downloaded

The JSON file looks like:
```json
{
  "type": "service_account",
  "project_id": "100bmol-portal",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
  "client_email": "portal-server@100bmol-portal.iam.gserviceaccount.com",
  ...
}
```

Map these fields to env vars:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=portal-server@100bmol-portal.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n
```

> **Encoding the key for env vars:** Private keys contain newlines. Store the entire `private_key` value from the JSON (including `\n` escape sequences) as a single-line string. The app reads it and replaces `\n` → real newlines at runtime.

### 4c — Grant domain-wide delegation (for Gmail)

To send email _as_ your Workspace address, the service account needs domain-wide delegation.

1. In the service account detail page, tick **Enable Google Workspace Domain-wide Delegation**
2. Note the **Client ID** shown (numeric, e.g. `112233445566778899`)
3. Go to your **Google Workspace Admin Console** → [admin.google.com](https://admin.google.com)
4. Navigate to **Security → Access and data control → API Controls → Manage domain-wide delegation**
5. Click **Add new** and enter:
   - Client ID: the numeric ID from step 2
   - OAuth scopes (comma-separated):
     ```
     https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/drive.file
     ```
6. Click **Authorise**

This allows the service account to send email on behalf of `GMAIL_SENDER_ADDRESS`.

```env
GMAIL_SENDER_ADDRESS=portal@100blackmenoflon.org
```

---

## 5 — Google Drive root folder

The portal uploads documents into a specific Drive folder.

1. In Google Drive, create a folder named `100BMOL Portal Documents`
2. Share it with your service account email (`portal-server@100bmol-portal.iam.gserviceaccount.com`) with **Editor** access
3. Open the folder — the URL will look like:
   `https://drive.google.com/drive/folders/1ABCDEfghijk...`
4. Copy the ID after `/folders/`

```env
GOOGLE_DRIVE_ROOT_FOLDER_ID=1ABCDEfghijk...
```

---

## 6 — Full `.env` reference

```env
# OAuth (sign-in)
GOOGLE_CLIENT_ID=123456789-abc...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
AUTH_SECRET=<output of: openssl rand -base64 32>

# Service account (email + Drive)
GOOGLE_SERVICE_ACCOUNT_EMAIL=portal-server@100bmol-portal.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n

# Gmail
GMAIL_SENDER_ADDRESS=portal@100blackmenoflon.org

# Drive
GOOGLE_DRIVE_ROOT_FOLDER_ID=1ABCDEfghijk...
```

---

## Security checklist

- [ ] OAuth consent screen is set to **Internal** (Workspace only)
- [ ] The service account JSON key file is **not committed to git** (add `*.json` to `.gitignore` or use the env var approach above)
- [ ] Domain-wide delegation scopes are minimal — only `gmail.send` and `drive.file`
- [ ] Production redirect URIs are added to the OAuth client before launch
- [ ] `AUTH_SECRET` is a different value in production vs development
