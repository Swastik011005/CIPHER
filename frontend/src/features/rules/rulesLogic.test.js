import { describe, expect, it } from 'vitest'

import { ApiError, createApiClient } from '../../api/client.js'
import {
  SIGNATURES,
  buildChanges,
  checkRestrictedAddress,
  describeIpsRule,
  fieldLabel,
  hitsFor,
  initialDraft,
  numericFields,
  orderChecks,
  parseField,
  parsePorts,
  rulesStatus,
  summariseChecks,
} from './rulesLogic.js'

/** A detectors object in the shape of GET /api/rules, with the shipped settings. */
function shipped() {
  const detector = (settings, limits, changed = []) => ({ settings, defaults: { ...settings }, limits, changed, editable: Object.keys(limits) })
  return {
    D1: detector({ enabled: true, window_s: 10, suspicious: 6, violation: 12, suppression_s: 30 }, { window_s: { min: 1, max: 60 }, suspicious: { min: 2, max: 50 }, violation: { min: 3, max: 100 }, suppression_s: { min: 0, max: 300 } }),
    D2: detector({ enabled: true, ports: [22, 23, 3389], window_s: 30, suspicious: 6, violation: 12, suppression_s: 30 }, { window_s: { min: 5, max: 120 }, suspicious: { min: 2, max: 50 }, violation: { min: 3, max: 100 }, suppression_s: { min: 0, max: 300 } }),
    D3: detector({ enabled: true, window_s: 5, suspicious_pps: 25, violation_pps: 50, suppression_s: 30 }, { window_s: { min: 1, max: 30 }, suspicious_pps: { min: 1, max: 500 }, violation_pps: { min: 2, max: 1000 }, suppression_s: { min: 0, max: 300 } }),
    D6: detector({ enabled: true, signatures: [...SIGNATURES], suppression_s: 30 }, { suppression_s: { min: 0, max: 300 } }),
  }
}

describe('reading typed values', () => {
  const d1 = shipped().D1
  it('accepts numbers inside the limits and says why not otherwise', () => {
    expect(parseField('D1', 'suspicious', '8', d1)).toEqual({ value: 8 })
    expect(parseField('D1', 'window_s', ' 7.5 ', d1)).toEqual({ value: 7.5 })
    expect(parseField('D1', 'suspicious', '1', d1).error).toBe('Between 2 and 50.')
    expect(parseField('D1', 'violation', '101', d1).error).toBe('Between 3 and 100.')
    expect(parseField('D1', 'suspicious', '6.5', d1).error).toBe('Use a whole number.')
    expect(parseField('D1', 'suspicious', '', d1).error).toBe('Type a number.')
    expect(parseField('D1', 'suspicious', 'abc', d1).error).toBe('Type a number.')
    expect(parseField('D1', 'suppression_s', '0', d1)).toEqual({ value: 0 })
  })

  it('reads port lists and signature lists', () => {
    expect(parsePorts('22, 2222;3389  23')).toEqual([22, 2222, 3389, 23])
    expect(parsePorts('22, x')).toBeNull()
    expect(parsePorts('')).toBeNull()
    expect(parsePorts('-1')).toBeNull()
    const d2 = shipped().D2
    expect(parseField('D2', 'ports', '22, 2222', d2)).toEqual({ value: [22, 2222] })
    expect(parseField('D2', 'ports', '22, 22', d2).error).toMatch(/twice/)
    expect(parseField('D2', 'ports', '0', d2).error).toMatch(/1 to 65535/)
    expect(parseField('D2', 'ports', '1,2,3,4,5,6,7,8,9,10,11', d2).error).toMatch(/At most 10/)
    expect(parseField('D2', 'ports', 'x', d2).error).toMatch(/port numbers/)
    const d6 = shipped().D6
    expect(parseField('D6', 'signatures', ['xmas', 'null'], d6)).toEqual({ value: ['null', 'xmas'] }) // canonical order
    expect(parseField('D6', 'signatures', [], d6).error).toMatch(/at least one/)
    expect(parseField('D6', 'enabled', false, d6)).toEqual({ value: false })
  })

  it('labels fields with what the number counts', () => {
    expect(fieldLabel('D1', 'suspicious')).toEqual({ label: 'MEDIUM at', unit: 'distinct ports' })
    expect(fieldLabel('D2', 'violation')).toEqual({ label: 'HIGH at', unit: 'attempts' })
    expect(fieldLabel('D3', 'suspicious_pps').unit).toBe('packets/s')
    expect(fieldLabel('D1', 'window_s')).toEqual({ label: 'Window', unit: 's' })
    expect(numericFields(shipped().D3)).toEqual(['window_s', 'suspicious_pps', 'violation_pps', 'suppression_s'])
  })
})

describe('the pending edit', () => {
  it('starts equal to the server, so nothing is pending', () => {
    const detectors = shipped()
    const draft = initialDraft(detectors)
    expect(draft.D1).toEqual({ enabled: true, window_s: '10', suspicious: '6', violation: '12', suppression_s: '30' })
    expect(draft.D2.ports).toBe('22, 23, 3389')
    expect(draft.D6.signatures).toEqual(SIGNATURES)
    expect(buildChanges(detectors, draft)).toEqual({ changes: {}, errors: {}, count: 0 })
  })

  it('collects only what differs, typed correctly, ready to send', () => {
    const detectors = shipped()
    const draft = initialDraft(detectors)
    draft.D1.enabled = false
    draft.D1.suspicious = '4'
    draft.D1.violation = '8'
    draft.D2.ports = '22, 2222'
    draft.D3.suspicious_pps = '30.5'
    draft.D6.signatures = ['null']
    const { changes, errors, count } = buildChanges(detectors, draft)
    expect(errors).toEqual({})
    expect(changes).toEqual({ D1: { enabled: false, suspicious: 4, violation: 8 }, D2: { ports: [22, 2222] }, D3: { suspicious_pps: 30.5 }, D6: { signatures: ['null'] } })
    expect(count).toBe(6)
  })

  it('does not count a value typed back to the shipped one, or a different spelling of it', () => {
    const detectors = shipped()
    const draft = initialDraft(detectors)
    draft.D1.suspicious = '6.0'
    draft.D2.ports = '22,23 3389'
    expect(buildChanges(detectors, draft).count).toBe(0)
  })

  it('reports errors by field and still collects the valid changes', () => {
    const detectors = shipped()
    const draft = initialDraft(detectors)
    draft.D1.suspicious = '1'
    draft.D3.window_s = '9'
    const { changes, errors } = buildChanges(detectors, draft)
    expect(errors).toEqual({ 'D1.suspicious': 'Between 2 and 50.' })
    expect(changes).toEqual({ D3: { window_s: 9 } })
  })

  it('flags MEDIUM thresholds that are not below HIGH, whichever of the two was edited', () => {
    const detectors = shipped()
    let draft = initialDraft(detectors)
    draft.D1.suspicious = '20'
    expect(buildChanges(detectors, draft).errors['D1.suspicious']).toMatch(/lower than the HIGH value \(12\)/)
    draft = initialDraft(detectors)
    draft.D1.violation = '5'
    expect(buildChanges(detectors, draft).errors['D1.suspicious']).toMatch(/\(5\)/)
    draft = initialDraft(detectors)
    draft.D3.suspicious_pps = '60'
    expect(buildChanges(detectors, draft).errors['D3.suspicious_pps']).toMatch(/\(50\)/)
    draft = initialDraft(detectors)
    draft.D1.suspicious = '20'
    draft.D1.violation = '30' // together they are fine
    expect(buildChanges(detectors, draft).errors).toEqual({})
  })
})

describe('restricted addresses', () => {
  it('accepts an outside IPv4 address and refuses the rest with the backend\'s reasons', () => {
    expect(checkRestrictedAddress(' 203.0.113.66 ', [])).toEqual({ address: '203.0.113.66' })
    expect(checkRestrictedAddress('203.0.113.66', ['203.0.113.66']).error).toMatch(/already restricted/)
    expect(checkRestrictedAddress('203.0.113.999', []).error).toMatch(/IPv4 address/)
    expect(checkRestrictedAddress('203.0.113', []).error).toMatch(/IPv4 address/)
    expect(checkRestrictedAddress('203.0.113.05', []).error).toMatch(/IPv4 address/)
    expect(checkRestrictedAddress('hello', []).error).toMatch(/IPv4 address/)
    expect(checkRestrictedAddress('203.0.113.5/24', []).error).toMatch(/IPv4 address/)
    expect(checkRestrictedAddress('127.0.0.1', []).error).toMatch(/cannot send from|not an address/)
    expect(checkRestrictedAddress('224.0.0.9', []).error).toMatch(/not an address/)
    expect(checkRestrictedAddress('10.0.10.11', []).error).toMatch(/inside the campus/)
    expect(checkRestrictedAddress('1.1.1.1', Array.from({ length: 20 }, (_, i) => `198.51.100.${i + 1}`)).error).toMatch(/At most 20/)
  })

  it('warns, but allows, a private address nothing outside uses', () => {
    const r = checkRestrictedAddress('192.168.1.5', [])
    expect(r.address).toBe('192.168.1.5')
    expect(r.warning).toMatch(/will not match anything/)
  })
})

describe('words for the IPS table and the status', () => {
  it('describes each action', () => {
    expect(describeIpsRule({ action: 'block_source', duration_s: 20 })).toBe('block the source for 20 s')
    expect(describeIpsRule({ action: 'rate_limit', rate_pps: 10, burst: 20 })).toBe('rate-limit the source to 10 packets/s (burst 20)')
    expect(describeIpsRule({ action: 'reject' })).toMatch(/TCP reset/)
    expect(describeIpsRule({ action: 'drop' })).toBe('drop the packet')
    expect(describeIpsRule({ action: 'allow' })).toMatch(/alert only/)
  })

  it('reads rule hits from the run, by policy and rule id', () => {
    const hits = { 'STAFF-IN:10': { count: 3 } }
    expect(hitsFor(hits, 'STAFF-IN', '10')).toBe(3)
    expect(hitsFor(hits, 'STAFF-IN', '20')).toBe(0)
    expect(hitsFor(undefined, 'STAFF-IN', '10')).toBe(0)
  })

  it('summarises the checks and lists failures first', () => {
    expect(summariseChecks({ runs: 12, runs_passed: 11, checks: 93, checks_passed: 90 })).toBe('11 of 12 runs pass · 90 of 93 checks')
    expect(orderChecks([{ id: 'a', passed: true }, { id: 'b', passed: false }, { id: 'c', passed: true }]).map((c) => c.id)).toEqual(['b', 'a', 'c'])
  })

  it('says whether the shipped or custom rules are in force and what differs', () => {
    const base = { customised: false, detectors: { D1: { changed: [] } }, restricted_ips: { addresses: ['203.0.113.99'], defaults: ['203.0.113.99'] } }
    expect(rulesStatus(base)).toEqual({ customised: false, text: 'Shipped rules: nothing has been changed.' })
    const edited = { ...base, customised: true, detectors: { D1: { changed: ['enabled', 'suspicious'] } }, restricted_ips: { addresses: [], defaults: ['203.0.113.99'] } }
    const status = rulesStatus(edited)
    expect(status.customised).toBe(true)
    expect(status.text).toContain('2 detector settings (D1.enabled, D1.suspicious)')
    expect(status.text).toContain('the restricted addresses')
    expect(rulesStatus(null)).toEqual({ customised: false, text: '' })
  })
})

describe('the API client for rules', () => {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
  const make = (handler) => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, init })
      return handler(url, init)
    }
    return { api: createApiClient({ baseUrl: '/api', fetchImpl }), calls }
  }

  it('sends detector edits, restricted lists, resets and validation to the right endpoints', async () => {
    const { api, calls } = make(() => json({ ok: true }))
    await api.rules()
    await api.putDetectors({ D1: { enabled: false } })
    await api.putRestrictedIps(['203.0.113.5'])
    await api.resetRules()
    await api.validate({ scenario_ids: ['S2'] })
    expect(calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/rules', 'PUT /api/rules/detectors', 'PUT /api/rules/restricted-ips', 'POST /api/rules/reset', 'POST /api/sim/validate',
    ])
    expect(JSON.parse(calls[1].init.body)).toEqual({ changes: { D1: { enabled: false } } })
    expect(JSON.parse(calls[2].init.body)).toEqual({ addresses: ['203.0.113.5'] })
    expect(JSON.parse(calls[4].init.body)).toEqual({ scenario_ids: ['S2'] })
  })

  it('keeps every reason when the server refuses an edit (HTTP 422 with a list)', async () => {
    const { api } = make(() => json({ detail: ['D1.suspicious: must be a whole number from 2 to 50', 'D9: no such detector (D1 to D6)'] }, 422))
    const error = await api.putDetectors({ D1: { suspicious: 1 } }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    expect(error.problems).toEqual(['D1.suspicious: must be a whole number from 2 to 50', 'D9: no such detector (D1 to D6)'])
    expect(error.message).toContain('D9')
  })

  it('has no problems list for other failures', async () => {
    const { api } = make(() => json({ detail: 'unknown scenario' }, 404))
    const error = await api.validate({ scenario_ids: ['S99'] }).catch((e) => e)
    expect(error.problems).toEqual([])
    expect(error.message).toBe('unknown scenario')
  })
})
