/**
 * Backend API client. All HTTP goes through here; components never call fetch directly.
 * Failures are surfaced as ApiError, never replaced with fabricated data.
 */

/**
 * @typedef {'network' | 'timeout' | 'http' | 'parse' | 'contract'} ApiErrorKind
 */

const GATEWAY_STATUSES = new Set([502, 503, 504])

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{kind: ApiErrorKind, status?: number, cause?: unknown}} details
   */
  constructor(message, { kind, status, cause, problems }) {
    super(message, { cause })
    this.name = 'ApiError'
    /** One message per problem when the server refused an edit with a list of reasons (HTTP 422), else empty. */
    this.problems = problems ?? []
    /** @type {ApiErrorKind} */
    this.kind = kind
    /** @type {number | undefined} */
    this.status = status
  }
}

/**
 * Pull a human-readable message out of a FastAPI error body.
 * @param {unknown} body
 * @param {string} fallback
 */
function describeErrorBody(body, fallback) {
  const detail = body && typeof body === 'object' ? body.detail : undefined
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((d) => d?.msg ?? String(d)).join('; ')
  }
  return fallback
}

/**
 * The API base from the build-time setting VITE_API_BASE: `/api` (same origin: development and demo mode) or the full
 * URL of a separately hosted API, e.g. `https://api.example.com/api`. Blank or unset means `/api`; trailing slashes go.
 * @param {string | undefined} value
 */
export function normaliseApiBase(value) {
  const base = (value ?? '').trim().replace(/\/+$/, '')
  return base === '' ? '/api' : base
}

export const API_BASE = normaliseApiBase(import.meta.env?.VITE_API_BASE)

/** True when the API is on another origin than the page (a separately hosted back end). */
export function isRemoteApi(base = API_BASE) {
  return /^https?:\/\//i.test(base)
}

/**
 * What to tell the person when the engine cannot be reached. A local engine has to be started by hand; a hosted one
 * may only be asleep (free hosting stops an idle service and takes about a minute to wake it).
 * @param {string} [base]
 */
export function offlineAdvice(base = API_BASE) {
  return isRemoteApi(base)
    ? 'The engine is hosted separately. If it was idle it may be waking up, which can take about a minute; this page keeps retrying.'
    : 'Start it with "python app.py"; retrying every 3 s.'
}

/**
 * @param {{baseUrl?: string, fetchImpl?: typeof fetch}} [options]
 */
export function createApiClient({ baseUrl = API_BASE, fetchImpl } = {}) {
  /**
   * @param {string} path
   * @param {{method?: string, body?: unknown, signal?: AbortSignal, timeoutMs?: number}} [options]
   */
  async function request(path, { method = 'GET', body, signal, timeoutMs = 8000 } = {}) {
    const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis)
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onCallerAbort = () => controller.abort()
    signal?.addEventListener('abort', onCallerAbort)

    try {
      let response
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (cause) {
        if (signal?.aborted) throw cause // the caller cancelled: let the abort propagate
        if (timedOut) {
          throw new ApiError(`Backend did not answer within ${timeoutMs / 1000}s`, { kind: 'timeout', cause })
        }
        throw new ApiError('Cannot reach the backend', { kind: 'network', cause })
      }

      // A dev proxy or gateway in front of a stopped backend answers 502/503/504 itself.
      if (GATEWAY_STATUSES.has(response.status)) {
        throw new ApiError(`Cannot reach the backend (gateway answered HTTP ${response.status})`, {
          kind: 'network',
          status: response.status,
        })
      }

      let payload
      const text = await response.text()
      try {
        payload = text ? JSON.parse(text) : null
      } catch (cause) {
        throw new ApiError(`Backend returned invalid JSON (HTTP ${response.status})`, {
          kind: response.ok ? 'parse' : 'http',
          status: response.status,
          cause,
        })
      }
      if (!response.ok) {
        const detail = payload && typeof payload === 'object' ? payload.detail : undefined
        throw new ApiError(describeErrorBody(payload, `HTTP ${response.status}`), {
          kind: 'http',
          status: response.status,
          problems: Array.isArray(detail) && detail.every((d) => typeof d === 'string') ? detail : [],
        })
      }
      return payload
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  return {
    /** @param {{signal?: AbortSignal}} [options] */
    async health(options) {
      return assertHealth(await request('/health', { timeoutMs: 2500, ...options }))
    },
    /** @param {{signal?: AbortSignal}} [options] */
    async topology(options) {
      return assertTopology(await request('/topology', options))
    },
    /** @param {{signal?: AbortSignal}} [options] */
    scenarios(options) {
      return request('/scenarios', options)
    },
    /**
     * @param {{scenario_id: string, seed?: number, ips_mode?: 'monitor' | 'enforce'}} body
     * @param {{signal?: AbortSignal}} [options]
     */
    runScenario(body, options) {
      return request('/sim/run', { method: 'POST', body, timeoutMs: 20000, ...options })
    },
    /** The rules in force, with limits and shipped values. @param {{signal?: AbortSignal}} [options] */
    rules(options) {
      return request('/rules', options)
    },
    /**
     * Change detector settings, e.g. `{D1: {enabled: false}}`. All of it is applied or none of it.
     * @param {Record<string, Record<string, unknown>>} changes
     */
    putDetectors(changes, options) {
      return request('/rules/detectors', { method: 'PUT', body: { changes }, ...options })
    },
    /** @param {string[]} addresses The complete restricted list. */
    putRestrictedIps(addresses, options) {
      return request('/rules/restricted-ips', { method: 'PUT', body: { addresses }, ...options })
    },
    /** The policies in force as Cisco IOS configuration text. */
    exportCisco(options) {
      return request('/rules/export/cisco', options)
    },
    resetRules(options) {
      return request('/rules/reset', { method: 'POST', ...options })
    },
    /** The nine presentation scenarios (P1 to P9) with what the launcher shows. */
    presentation(options) {
      return request('/presentation', options)
    },
    /** Isolated endpoints, device trust, roles, revoked permissions and cumulative rule counters. */
    securityState(options) {
      return request('/state', options)
    },
    /**
     * An operator action: isolate, restore, trust, role, revoke, grant or reset.
     * @param {{action: string, node?: string, user?: string, level?: string, role?: string, resource?: string}} body
     */
    stateAction(body, options) {
      return request('/state/action', { method: 'POST', body, ...options })
    },
    /** One whitelisted endpoint command, run through the simulation engine. @param {{node: string, command: string, ips_mode?: string, animate?: boolean}} body */
    cliExec(body, options) {
      return request('/cli/exec', { method: 'POST', body, timeoutMs: 20000, ...options })
    },
    /** What Zero Trust would decide, and why. @param {{device: string, resource: string, proto?: string, port?: number|null}} body */
    explainZeroTrust(body, options) {
      return request('/zerotrust/explain', { method: 'POST', body, ...options })
    },
    zeroTrust(options) {
      return request('/zerotrust', options)
    },
    /** One endpoint's identity, addressing, trust and health. */
    endpoint(node, options) {
      return request(`/endpoints/${encodeURIComponent(node)}`, options)
    },
    /** The SIEM's retained event history and its incidents. */
    siemEvents(options) {
      return request('/siem/events', options)
    },
    /** Run scenarios with the rules in force and check what they should do. @param {{scenario_ids?: string[]}} body */
    validate(body, options) {
      return request('/sim/validate', { method: 'POST', body, timeoutMs: 60000, ...options })
    },
  }
}

/**
 * Contract guard: a response that does not have the expected shape is an error, not data.
 * @param {any} body
 */
export function assertHealth(body) {
  if (!body || body.status !== 'ok' || typeof body.service !== 'string' || !body.topology) {
    throw new ApiError('Unexpected /health response shape', { kind: 'contract' })
  }
  return body
}

/**
 * @param {any} body
 */
export function assertTopology(body) {
  const ok =
    body &&
    Array.isArray(body.nodes) &&
    Array.isArray(body.links) &&
    Array.isArray(body.zones) &&
    Array.isArray(body.vlans) &&
    Array.isArray(body.subnets) &&
    body.summary &&
    body.validation
  if (!ok) throw new ApiError('Unexpected /topology response shape', { kind: 'contract' })
  return body
}

export const api = createApiClient()
