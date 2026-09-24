// Client for the teacher.dev auth broker. Google credentials never pass through
// Test Parrot: the broker keeps the refresh token behind its own HttpOnly
// cookie, and the browser asks it for short-lived `drive.file` access tokens.
// Signing in and allowing Drive access are two separate redirects.

const BROKER = (import.meta.env.VITE_AUTH_BROKER_URL?.trim() || 'https://auth.teacher.dev').replace(/\/+$/, '')

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export type DriveConnection = {
  connected: boolean
  status?: 'active' | 'invalid'
  googleUserId?: string
  googleEmail?: string
  grantedScopes?: string[]
  lastError?: string
}

type DriveToken = {
  accessToken: string
  expiresAt: string
  grantedScopes: string[]
}

export class BrokerError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'BrokerError'
    this.status = status
    this.code = code
  }
  get signedOut() { return this.status === 401 }
  get needsConnection() { return this.status === 404 || this.status === 409 }
}

function messageFor(status: number, code: string): string {
  switch (status) {
    case 401: return 'You are signed out. Sign in with Google to continue.'
    case 404: return 'Google Drive access has not been allowed yet.'
    case 409: return 'Your Google Drive connection stopped working. Allow Drive access again to continue.'
    case 429: return 'Too many requests. Wait a minute and try again.'
    case 403: return code === 'origin_not_allowed'
      ? 'This site is not allowed to use the sign-in service.'
      : 'The sign-in service refused this request.'
    case 502: return 'Google could not be reached. Try again in a moment.'
    default: return `The sign-in service returned an error (${status}).`
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(BROKER + path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...init.headers },
    })
  } catch {
    throw new BrokerError('The sign-in service could not be reached.', 0, 'network')
  }
}

async function failure(response: Response): Promise<BrokerError> {
  const body = await response.json().catch(() => ({})) as { error?: unknown }
  const code = typeof body.error === 'string' ? body.error : `http_${response.status}`
  return new BrokerError(messageFor(response.status, code), response.status, code)
}

function currentPlace() {
  return `${window.location.pathname}${window.location.search}` || '/'
}

async function startFlow(path: string, returnTo: string): Promise<void> {
  const response = await call(path, { method: 'POST', body: JSON.stringify({ returnTo }) })
  if (!response.ok) throw await failure(response)
  const { authorizationUrl } = await response.json() as { authorizationUrl?: string }
  if (!authorizationUrl) throw new BrokerError('The sign-in service did not return a Google URL.', 502, 'missing_url')
  window.location.href = authorizationUrl
}

/** Leaves the page for Google sign-in; the broker brings the teacher back. */
export function signIn(returnTo = currentPlace()) {
  return startFlow('/auth/google/start', returnTo)
}

/** Leaves the page for Google's Drive permission screen. */
export async function allowDrive(returnTo = currentPlace()) {
  try {
    await startFlow('/oauth/google/start', returnTo)
  } catch (caught) {
    if (caught instanceof BrokerError && caught.signedOut) return signIn(returnTo)
    throw caught
  }
}

export async function signOut(): Promise<void> {
  const response = await call('/auth/logout', { method: 'POST' })
  if (!response.ok && response.status !== 401) throw await failure(response)
  clearAuthorization()
}

/** `null` means signed out. */
export async function getConnection(): Promise<DriveConnection | null> {
  const response = await call('/oauth/google/connection')
  if (response.status === 401) return null
  if (!response.ok) throw await failure(response)
  return await response.json() as DriveConnection
}

export function driveAllowed(connection: DriveConnection | null) {
  return Boolean(connection?.connected
    && connection.status !== 'invalid'
    && (connection.grantedScopes ?? [DRIVE_FILE_SCOPE]).includes(DRIVE_FILE_SCOPE))
}

// Access tokens live only in memory and are re-minted a minute before expiry.
let token: DriveToken | null = null
let minting: Promise<DriveToken> | null = null

function isFresh(candidate: DriveToken | null): candidate is DriveToken {
  return candidate !== null && Date.now() < Date.parse(candidate.expiresAt) - 60_000
}

export async function accessToken(): Promise<string> {
  if (isFresh(token)) return token.accessToken
  minting ??= (async () => {
    const response = await call('/oauth/google/token', { method: 'POST' })
    if (!response.ok) throw await failure(response)
    const minted = await response.json() as DriveToken
    if (!minted.grantedScopes.includes(DRIVE_FILE_SCOPE)) {
      throw new BrokerError('Allow Google Drive access to keep syncing.', 409, 'scope_missing')
    }
    token = minted
    return minted
  })().finally(() => { minting = null })
  return (await minting).accessToken
}

export function clearAuthorization() { token = null }

/** The broker returns with `?error=<code>` when a redirect did not complete. */
export function consumeArrivalError(): string | null {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('error')
  if (code === null) return null
  url.searchParams.delete('error')
  window.history.replaceState(window.history.state, '', url)
  return code
}

export function describeArrivalError(code: string): string {
  if (code === 'access_denied') return 'Google sign-in was cancelled.'
  if (code === 'google_account_mismatch') return 'Allow Drive access with the same Google account you signed in with.'
  if (code === 'unauthorized' || code === 'invalid_state') return 'The sign-in link expired. Try again.'
  return `Google sign-in did not complete (${code}). Try again.`
}
