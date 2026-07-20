/**
 * Google API helpers — Drive upload
 * All functions are server-side only. Never import in client-side code.
 *
 * For Gmail, use src/lib/gmail.ts which handles domain-wide delegation.
 */

import { google } from 'googleapis'
import { Readable } from 'stream'

/**
 * Parse the service account private key from env.
 * The env var stores the PEM key with literal \n sequences; we convert them
 * to real newlines so the JWT signer can read them.
 */
function parsePrivateKey(): string {
  const raw = import.meta.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? ''
  return raw.replace(/\\n/g, '\n')
}

function getDriveAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
      private_key: parsePrivateKey(),
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })
}

// ─── Google Drive ────────────────────────────────────────────────────────────

/**
 * Upload a file buffer to Google Drive.
 * Returns the Drive file URL (drive.google.com/file/d/{id}/view).
 *
 * The file is placed in:
 *   <GOOGLE_DRIVE_ROOT_FOLDER_ID> / {memberFolder} / {filename}
 */
export async function uploadToDrive(options: {
  filename: string
  mimeType: string
  buffer: Buffer
  memberFolder: string
}): Promise<string> {
  const { filename, mimeType, buffer, memberFolder } = options

  const auth = getDriveAuth()
  const drive = google.drive({ version: 'v3', auth })

  const rootFolderId = import.meta.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? ''

  // Ensure member sub-folder exists
  const memberFolderId = await getOrCreateFolder(drive, memberFolder, rootFolderId)

  // Upload file
  const { data: file } = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [memberFolderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id',
  })

  if (!file.id) throw new Error('Drive upload returned no file ID')

  // Grant read access to anyone with the link (internal sharing)
  await drive.permissions.create({
    fileId: file.id,
    requestBody: { role: 'reader', type: 'anyone' },
  })

  return `https://drive.google.com/file/d/${file.id}/view`
}

async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string,
): Promise<string> {
  const safeName = name.replace(/'/g, "\\'")
  const { data } = await drive.files.list({
    q: `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  })

  if (data.files && data.files.length > 0 && data.files[0]?.id) {
    return data.files[0].id
  }

  const { data: created } = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  })

  if (!created.id) throw new Error(`Failed to create Drive folder: ${name}`)
  return created.id
}
