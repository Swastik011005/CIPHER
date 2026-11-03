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
 * @param {{baseUrl?: string, fetchImpl?: typeof fetch}} [options]
 */
export function createApiClient({ baseUrl = import.meta.env?.VITE_API_BASE ?? '/api', fetchImpl } = {}) {
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
