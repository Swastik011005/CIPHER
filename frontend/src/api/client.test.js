import { describe, expect, it } from 'vitest'

import { ApiError, assertHealth, assertTopology, createApiClient } from './client.js'

/** Build a fetch that answers with a fixed response, recording what it was asked. */
function fakeFetch(respond) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return respond(url, init)
  }
  return { impl, calls }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

const HEALTH = { status: 'ok', service: 'cipher-engine', topology: { loaded: true } }
const TOPOLOGY = {
  nodes: [], links: [], zones: [], vlans: [], subnets: [], summary: {}, validation: { passed: true },
}

describe('api client', () => {
  it('returns the parsed body of a successful health check', async () => {
    const { impl, calls } = fakeFetch(() => json(HEALTH))
    const api = createApiClient({ baseUrl: '/api', fetchImpl: impl })
    await expect(api.health()).resolves.toEqual(HEALTH)
    expect(calls[0].url).toBe('/api/health')
  })

  it('reports an unreachable backend as a network error, not as data', async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const api = createApiClient({ fetchImpl: impl })
    const error = await api.health().catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe('network')
    expect(error.message).toMatch(/cannot reach/i)
  })

  it('treats a gateway answer for a stopped backend as a network error', async () => {
    for (const status of [502, 503, 504]) {
      const { impl } = fakeFetch(() => new Response('', { status }))
      const error = await createApiClient({ fetchImpl: impl }).health().catch((e) => e)
      expect(error.kind).toBe('network')
      expect(error.status).toBe(status)
    }
  })

  it('surfaces FastAPI error details for HTTP errors', async () => {
    const { impl } = fakeFetch(() => json({ detail: "unknown scenario 'S9'" }, 404))
    const error = await createApiClient({ fetchImpl: impl }).scenarios().catch((e) => e)
    expect(error).toMatchObject({ kind: 'http', status: 404, message: "unknown scenario 'S9'" })
  })

  it('joins validation error messages from a 422 body', async () => {
    const { impl } = fakeFetch(() => json({ detail: [{ msg: 'field required' }, { msg: 'bad seed' }] }, 422))
    const error = await createApiClient({ fetchImpl: impl }).runScenario({ scenario_id: '' }).catch((e) => e)
    expect(error.message).toBe('field required; bad seed')
  })

  it('reports invalid JSON from a 200 as a parse error', async () => {
    const { impl } = fakeFetch(() => new Response('<html>not json</html>', { status: 200 }))
    const error = await createApiClient({ fetchImpl: impl }).scenarios().catch((e) => e)
    expect(error).toMatchObject({ kind: 'parse' })
  })

  it('times out a health check that never answers', async () => {
    const impl = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const error = await createApiClient({ fetchImpl: impl }).health().catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe('timeout')
  }, 10000)

  it('lets a caller abort without turning it into an ApiError', async () => {
    const controller = new AbortController()
    const impl = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const pending = createApiClient({ fetchImpl: impl }).health({ signal: controller.signal })
    controller.abort()
    const error = await pending.catch((e) => e)
    expect(error).not.toBeInstanceOf(ApiError)
    expect(error.name).toBe('AbortError')
  })

  it('sends run requests as JSON POST', async () => {
    const { impl, calls } = fakeFetch(() => json({ run_id: 'r' }))
    await createApiClient({ fetchImpl: impl }).runScenario({ scenario_id: 'S1', seed: 3 })
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body)).toEqual({ scenario_id: 'S1', seed: 3 })
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
  })
})

describe('contract guards', () => {
  it('accepts the documented health and topology shapes', () => {
    expect(assertHealth(HEALTH)).toBe(HEALTH)
    expect(assertTopology(TOPOLOGY)).toBe(TOPOLOGY)
  })

  it('rejects a health body that is not ok or lacks fields', () => {
    for (const bad of [null, {}, { status: 'degraded', service: 'x', topology: {} }, { status: 'ok', topology: {} }]) {
      expect(() => assertHealth(bad)).toThrow(ApiError)
    }
  })

  it('rejects a topology missing any required collection', () => {
    for (const key of ['nodes', 'links', 'zones', 'vlans', 'subnets', 'summary', 'validation']) {
      const { [key]: _removed, ...rest } = TOPOLOGY
      expect(() => assertTopology(rest)).toThrow(/shape/)
    }
  })
})
