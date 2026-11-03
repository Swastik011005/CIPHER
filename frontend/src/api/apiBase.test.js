import { describe, expect, it } from 'vitest'

import { ApiError, createApiClient, isRemoteApi, normaliseApiBase, offlineAdvice } from './client.js'
import { readOnlyNotice } from '../features/rules/rulesLogic.js'

describe('the API base (VITE_API_BASE)', () => {
  it('is /api when unset or blank, and a trailing slash is dropped', () => {
    expect(normaliseApiBase(undefined)).toBe('/api')
    expect(normaliseApiBase('')).toBe('/api')
    expect(normaliseApiBase('   ')).toBe('/api')
    expect(normaliseApiBase('/api/')).toBe('/api')
    expect(normaliseApiBase(' https://netsec-3d-api.onrender.com/api/ ')).toBe('https://netsec-3d-api.onrender.com/api')
  })

  it('tells a separately hosted API from the same-origin one', () => {
    expect(isRemoteApi('/api')).toBe(false)
    expect(isRemoteApi('https://netsec-3d-api.onrender.com/api')).toBe(true)
    expect(isRemoteApi('http://127.0.0.1:8300/api')).toBe(true)
  })

  it('sends every request to the configured origin', async () => {
    const urls = []
    const fetchImpl = async (url) => {
      urls.push(url)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    const client = createApiClient({ baseUrl: 'https://netsec-3d-api.onrender.com/api', fetchImpl })
    await client.scenarios()
    await client.rules()
    expect(urls).toEqual(['https://netsec-3d-api.onrender.com/api/scenarios', 'https://netsec-3d-api.onrender.com/api/rules'])
  })

  it('keeps the local wording exactly, and gives a different, accurate hint for a hosted engine', () => {
    expect(offlineAdvice('/api')).toBe('Start it with "python app.py"; retrying every 3 s.')
    expect(offlineAdvice('https://netsec-3d-api.onrender.com/api')).toMatch(/waking up.*about a minute.*retrying/)
    expect(offlineAdvice('https://netsec-3d-api.onrender.com/api')).not.toMatch(/python app\.py/)
  })
})

describe('what the client does with the server refusing an edit (read-only rules)', () => {
  const refuse = (status, detail) => async () => new Response(JSON.stringify({ detail }), { status })

  it('surfaces a 403 as an HTTP error carrying the server message', async () => {
    const client = createApiClient({ baseUrl: '/api', fetchImpl: refuse(403, 'Rules are read-only on this server.') })
    const error = await client.putDetectors({ D1: { enabled: false } }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'http', status: 403, message: 'Rules are read-only on this server.', problems: [] })
  })

  it('surfaces a 429 with its message, so the page can say why a run did not start', async () => {
    const client = createApiClient({ baseUrl: '/api', fetchImpl: refuse(429, 'Too many requests: try again in 5 s.') })
    const error = await client.runScenario({ scenario_id: 'S1' }).catch((e) => e)
    expect(error).toMatchObject({ kind: 'http', status: 429, message: 'Too many requests: try again in 5 s.' })
  })

  it('surfaces a 413 with its message', async () => {
    const client = createApiClient({ baseUrl: '/api', fetchImpl: refuse(413, 'The request body is larger than the 65536 byte limit.') })
    const error = await client.runScenario({ scenario_id: 'S1' }).catch((e) => e)
    expect(error).toMatchObject({ kind: 'http', status: 413 })
  })
})

describe('the read-only notice', () => {
  it('is absent when rules can be edited, as in a local run', () => {
    expect(readOnlyNotice(null)).toBeNull()
    expect(readOnlyNotice({})).toBeNull()
    expect(readOnlyNotice({ read_only: false, read_only_reason: null })).toBeNull()
  })

  it('says what is locked and what still works, using the server reason', () => {
    const notice = readOnlyNotice({ read_only: true, read_only_reason: 'Rules are read-only on this server. Shared by all.' })
    expect(notice.title).toBe('Rules are read-only on this server')
    expect(notice.text).toContain('Shared by all.')
    expect(notice.text).toMatch(/run every scenario.*export the policy/)
  })

  it('still explains itself if the server sent no reason', () => {
    expect(readOnlyNotice({ read_only: true }).text).toMatch(/shared by every visitor/)
  })
})
