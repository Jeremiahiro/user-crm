/**
 * Dev-only login bypass. Must stay false on any deployed build, including
 * Vercel preview, even if DEV_USER_EMAIL is present in the environment.
 */
export interface DevAuthEnv {
  dev: boolean
  prod: boolean
  nodeEnv?: string | undefined
  vercelEnv?: string | undefined
  devUserEmail?: string | undefined
}

export function isDevAuthBypassEnabled(env: DevAuthEnv): boolean {
  if (!env.dev || env.prod) return false
  if (env.nodeEnv === 'production') return false
  if (env.vercelEnv === 'production' || env.vercelEnv === 'preview') return false
  return Boolean(env.devUserEmail?.trim())
}
