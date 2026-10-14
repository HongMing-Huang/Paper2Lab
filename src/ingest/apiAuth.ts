// Optional API token (pairs with the backend's PAPER2LAB_API_TOKEN guard):
// when the deployment sets that env, every /api/* call must present it.
// Unset env = open local dev — the headers are simply empty.
//
// Token sources (first match wins):
//   1. VITE_PAPER2LAB_API_TOKEN — build-time, for self-hosted bundles
//   2. localStorage['p2l-api-token'] — runtime paste, for operators behind
//      a proxy who set the server env after the bundle was built
export function apiToken(): string | null {
  const fromBuild = import.meta.env.VITE_PAPER2LAB_API_TOKEN as string | undefined
  if (fromBuild) return fromBuild
  try {
    return localStorage.getItem('p2l-api-token') || null
  } catch {
    return null // private mode / SSR — no token, backend decides
  }
}

/** spread into fetch options: `headers: { ...authHeaders() }` */
export function authHeaders(): Record<string, string> {
  const token = apiToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
