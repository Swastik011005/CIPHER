/**
 * The Rules editor as plain logic: what each setting is called, how a typed value is read, which edits are
 * pending, and how an IPS rule reads in words. The backend validates everything again and is the only place
 * rules are stored; these checks exist so a mistake is shown next to the field before anything is sent.
 */

/** Human labels and units for the editable numeric fields, keyed by field name (the same names the API uses). */
export const FIELD_LABELS = Object.freeze({
  window_s: { label: 'Window', unit: 's', integer: false },
  suspicious: { label: 'MEDIUM at', unit: '', integer: true },
  violation: { label: 'HIGH at', unit: '', integer: true },
  suspicious_pps: { label: 'MEDIUM above', unit: 'packets/s', integer: false },
  violation_pps: { label: 'HIGH above', unit: 'packets/s', integer: false },
  suppression_s: { label: 'One alert per source and target every', unit: 's', integer: false },
})

/** What "suspicious" and "violation" count, per detector, so the label says what the number means. */
export const COUNT_UNIT = Object.freeze({ D1: 'distinct ports', D2: 'attempts' })

export const SIGNATURE_LABELS = Object.freeze({
  null: 'NULL (no flags)',
  xmas: 'XMAS (FIN, PSH, URG)',
  syn_fin: 'SYN + FIN',
  syn_rst: 'SYN + RST',
  fin_rst: 'FIN + RST',
})
export const SIGNATURES = Object.freeze(Object.keys(SIGNATURE_LABELS))

/** @param {string} detector @param {string} field */
export function fieldLabel(detector, field) {
  const base = FIELD_LABELS[field]
  if (!base) return { label: field, unit: '' }
  const unit = base.unit || COUNT_UNIT[detector] || ''
  return { label: base.label, unit }
}

/** Fields shown as number inputs for a detector, in display order, from the API's `limits`. */
export function numericFields(detector) {
  return Object.keys(detector.limits)
}

/**
 * The draft starts as the server's settings, with numbers as text so half-typed values are kept as typed.
 * @param {Record<string, any>} detectors  `rules.detectors` from the API.
 */
export function initialDraft(detectors) {
  const draft = {}
  for (const [id, d] of Object.entries(detectors)) {
    draft[id] = { enabled: d.settings.enabled }
    for (const field of numericFields(d)) draft[id][field] = String(d.settings[field])
    if ('ports' in d.settings) draft[id].ports = d.settings.ports.join(', ')
    if ('signatures' in d.settings) draft[id].signatures = [...d.settings.signatures]
  }
  return draft
}

/** "22, 2222 3389" -> [22, 2222, 3389], or null if any part is not a whole number. */
export function parsePorts(text) {
  const parts = String(text).split(/[\s,;]+/).filter(Boolean)
  const ports = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN))
  return ports.length > 0 && ports.every((p) => Number.isInteger(p)) ? ports : null
}

/**
 * Read one typed value for a field. Returns `{value}` or `{error}` in plain words.
 * @param {string} detectorId
 * @param {string} field
 * @param {any} raw  What the control holds (text, boolean or list).
 * @param {{limits: Record<string, {min: number, max: number}>}} detector
 */
export function parseField(detectorId, field, raw, detector) {
  if (field === 'enabled') return { value: Boolean(raw) }
  if (field === 'ports') {
    const ports = parsePorts(raw)
    if (!ports) return { error: 'Type one or more port numbers separated by commas, for example 22, 23, 3389.' }
    if (ports.length > 10) return { error: 'At most 10 ports.' }
    if (new Set(ports).size !== ports.length) return { error: 'A port is listed twice.' }
    if (ports.some((p) => p < 1 || p > 65535)) return { error: 'Ports go from 1 to 65535.' }
    return { value: ports }
  }
  if (field === 'signatures') {
    if (!Array.isArray(raw) || raw.length === 0) return { error: 'Keep at least one signature, or switch the detector off.' }
    return { value: SIGNATURES.filter((s) => raw.includes(s)) }
  }
  const limit = detector.limits[field]
  const text = String(raw).trim()
  if (text === '' || Number.isNaN(Number(text))) return { error: 'Type a number.' }
  const value = Number(text)
  if (FIELD_LABELS[field]?.integer && !Number.isInteger(value)) return { error: 'Use a whole number.' }
  if (limit && (value < limit.min || value > limit.max)) return { error: `Between ${limit.min} and ${limit.max}.` }
  return { value }
}

const same = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b)

/**
 * Compare the draft with the server's settings.
 * @returns {{changes: Record<string, Record<string, any>>, errors: Record<string, string>, count: number}}
 *   `changes` is ready to send; `errors` is keyed `D1.suspicious`.
 */
export function buildChanges(detectors, draft) {
  const changes = {}
  const errors = {}
  let count = 0
  for (const [id, d] of Object.entries(detectors)) {
    const fields = draft[id] ?? {}
    for (const field of Object.keys(fields)) {
      const parsed = parseField(id, field, fields[field], d)
      if (parsed.error) {
        errors[`${id}.${field}`] = parsed.error
        continue
      }
      if (!same(parsed.value, d.settings[field])) {
        ;(changes[id] ??= {})[field] = parsed.value
        count += 1
      }
    }
    // Thresholds must stay in order: MEDIUM below HIGH. Say so beside the field that is out of place.
    for (const [low, high] of [['suspicious', 'violation'], ['suspicious_pps', 'violation_pps']]) {
      if (!(low in fields) || errors[`${id}.${low}`] || errors[`${id}.${high}`]) continue
      const lowValue = changes[id]?.[low] ?? d.settings[low]
      const highValue = changes[id]?.[high] ?? d.settings[high]
      if (lowValue >= highValue) errors[`${id}.${low}`] = `Must be lower than the HIGH value (${highValue}).`
    }
  }
  return { changes, errors, count }
}

/** The IPv4 address check for the restricted list, with the same reasons the backend gives. */
export function checkRestrictedAddress(text, existing, max = 20) {
  const address = String(text).trim()
  const parts = address.split('.')
  const valid = parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && String(Number(p)) === p)
  if (!valid) return { error: 'Type an IPv4 address such as 203.0.113.99.' }
  if (existing.includes(address)) return { error: `${address} is already restricted.` }
  if (existing.length >= max) return { error: `At most ${max} addresses.` }
  const [a, b] = parts.map(Number)
  if (a === 127 || a === 0 || a >= 224) return { error: `${address} is not an address a host can send from.` }
  if (a === 10) return { error: `${address} is inside the campus. FW1 only filters traffic arriving from outside.` }
  if (a === 192 && b === 168) return { warning: 'Private address: no outside host uses it in this network, so it will not match anything.', address }
  return { address }
}

/** One IPS policy rule in words. */
export function describeIpsRule(rule) {
  switch (rule.action) {
    case 'block_source':
      return `block the source for ${rule.duration_s} s`
    case 'rate_limit':
      return `rate-limit the source to ${rule.rate_pps} packets/s (burst ${rule.burst})`
    case 'reject':
      return 'reject the connection with a TCP reset'
    case 'drop':
      return 'drop the packet'
    case 'allow':
      return 'alert only, let it through'
    default:
      return rule.action
  }
}

/** What the loaded run has hit on a rule, from the player's counters: `STAFF-IN:10` style ids. */
export function hitsFor(ruleHits, policyName, ruleId) {
  return ruleHits?.[`${policyName}:${ruleId}`]?.count ?? 0
}

/** "12 of 12 runs pass, 93 of 93 checks" for the validation summary. */
export function summariseChecks(summary) {
  return `${summary.runs_passed} of ${summary.runs} runs pass · ${summary.checks_passed} of ${summary.checks} checks`
}

/** Failing checks first within a run, so a broken expectation is the first thing seen. */
export function orderChecks(checks) {
  return [...checks].sort((a, b) => Number(a.passed) - Number(b.passed))
}

/** The rules banner: shipped, or customised with what differs. */
export function rulesStatus(rules) {
  if (!rules) return { customised: false, text: '' }
  const changed = Object.entries(rules.detectors).flatMap(([id, d]) => d.changed.map((f) => `${id}.${f}`))
  const restricted = rules.restricted_ips.addresses.join() !== rules.restricted_ips.defaults.join()
  if (!rules.customised) return { customised: false, text: 'Shipped rules: nothing has been changed.' }
  const parts = []
  if (changed.length) parts.push(`${changed.length} detector setting${changed.length === 1 ? '' : 's'} (${changed.slice(0, 4).join(', ')}${changed.length > 4 ? ', …' : ''})`)
  if (restricted) parts.push('the restricted addresses')
  return { customised: true, text: `Custom rules in force: ${parts.join(' and ')}.` }
}

/**
 * Whether the server has locked the rules (a public deployment: the rules are shared by every visitor), and what to say.
 * `null` when rules can be edited, exactly as in a local run.
 * @param {{read_only?: boolean, read_only_reason?: string | null} | null | undefined} rules  The GET /api/rules response.
 * @returns {{title: string, text: string} | null}
 */
export function readOnlyNotice(rules) {
  if (!rules?.read_only) return null
  return {
    title: 'Rules are read-only on this server',
    text:
      (rules.read_only_reason ?? 'The rules are shared by every visitor, so they cannot be changed here.') +
      ' You can still read every rule, run every scenario, run all checks and export the policy as Cisco IOS text.',
  }
}
