/**
 * The Send traffic form, as plain logic: what the user may choose, and how a choice becomes a flow the
 * engine accepts. The backend re-validates everything, so these checks exist to give an immediate,
 * readable message, never to be the only guard.
 */

export const TCP_FLAGS = Object.freeze(['SYN', 'ACK', 'FIN', 'RST', 'PSH', 'URG'])
export const MAX_CUSTOM_FLOWS = 5
export const MAX_REPEATS = 10

/** Kinds of traffic the form can send, each mapping to one engine flow type. */
export const KINDS = Object.freeze([
  { value: 'tcp', label: 'TCP connection', hint: 'A full TCP session: handshake, one request and response, close.' },
  { value: 'flags', label: 'TCP with chosen flags', hint: 'Raw TCP segments with exactly the flags you pick, for example a NULL or XMAS probe.' },
  { value: 'ping', label: 'Ping (ICMP echo)', hint: 'ICMP echo requests; the destination answers each one.' },
])

/** Flag combinations worth one click. */
export const FLAG_PRESETS = Object.freeze([
  { label: 'NULL', flags: [] },
  { label: 'XMAS', flags: ['FIN', 'PSH', 'URG'] },
  { label: 'SYN+FIN', flags: ['SYN', 'FIN'] },
  { label: 'SYN', flags: ['SYN'] },
])

/** The case Rev 3 names: a staff PC trying to reach the database directly. */
export const STAFF_TO_DATABASE = Object.freeze({ source: 'PC-1', destination: 'DB-SRV', kind: 'tcp', port: 3306, flags: ['SYN'], count: 1 })

export const DEFAULT_FORM = Object.freeze({ ...STAFF_TO_DATABASE })

/**
 * Hosts that can send or receive: topology nodes of a host-like type that have an address.
 * @param {{nodes: {id: string, label: string, type: string, interfaces: {ip?: string|null}[]}[]}|null} topology
 */
export function trafficHosts(topology) {
  if (!topology) return []
  return topology.nodes
    .filter((n) => (n.type === 'host' || n.type === 'syslog') && n.interfaces.some((i) => i.ip))
    .map((n) => ({ id: n.id, label: n.label, address: n.interfaces.find((i) => i.ip).ip }))
}

/** Seconds, rounded up to a tenth, so the flow starts at or just after the playhead and never before it. */
export function startTimeFor(playhead) {
  return Math.max(0, Math.ceil(playhead * 10 - 1e-9) / 10) // max() turns -0 into 0
}

/** Next unused `X<n>` id. */
export function nextFlowId(existing) {
  const used = new Set(existing.map((f) => f.id))
  for (let n = 1; n <= MAX_CUSTOM_FLOWS + 1; n += 1) if (!used.has(`X${n}`)) return `X${n}`
  return `X${used.size + 1}`
}

/**
 * Check a form. Returns a list of problems in plain words (empty when it can be sent).
 * @param {typeof DEFAULT_FORM} form
 * @param {{id: string}[]} hosts
 * @param {number} existingCount  Custom flows already in the run.
 */
export function validateForm(form, hosts, existingCount = 0) {
  const problems = []
  const ids = new Set(hosts.map((h) => h.id))
  if (!ids.has(form.source)) problems.push('Choose a source host.')
  if (!ids.has(form.destination)) problems.push('Choose a destination host.')
  if (form.source === form.destination && ids.has(form.source)) problems.push('Source and destination must be different hosts.')
  if (form.kind !== 'ping') {
    const port = Number(form.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('The port must be a whole number from 1 to 65535.')
  }
  if (form.kind !== 'tcp') {
    const count = Number(form.count)
    if (!Number.isInteger(count) || count < 1 || count > MAX_REPEATS) problems.push(`The count must be a whole number from 1 to ${MAX_REPEATS}.`)
  }
  if (form.kind === 'flags' && !form.flags.every((f) => TCP_FLAGS.includes(f))) problems.push('Unknown TCP flag.')
  if (!KINDS.some((k) => k.value === form.kind)) problems.push('Choose a kind of traffic.')
  if (existingCount >= MAX_CUSTOM_FLOWS) problems.push(`At most ${MAX_CUSTOM_FLOWS} injected flows per run. Clear them first.`)
  return problems
}

/**
 * The engine flow for a form, starting at `start` seconds.
 * @param {typeof DEFAULT_FORM} form
 * @param {{id: string, start: number}} where
 */
export function buildCustomFlow(form, { id, start }) {
  const common = { id, src: form.source, dst: form.destination, start }
  if (form.kind === 'ping') return { type: 'icmp_echo', ...common, count: Number(form.count), interval: 1.0, payload_bytes: 32 }
  if (form.kind === 'flags') {
    const flags = TCP_FLAGS.filter((f) => form.flags.includes(f)) // canonical order
    return { type: 'flag_probe', ...common, dport: Number(form.port), flags, count: Number(form.count), interval: 0.5 }
  }
  return { type: 'tcp_session', ...common, dport: Number(form.port), request_bytes: 100 }
}

/** A short description of a custom flow for the list in the panel. */
export function describeCustomFlow(flow) {
  if (flow.type === 'icmp_echo') return `${flow.src} pings ${flow.dst} × ${flow.count}`
  if (flow.type === 'flag_probe') return `${flow.src} → ${flow.dst}:${flow.dport} flags ${flow.flags.length ? flow.flags.join('+') : 'none (NULL)'} × ${flow.count}`
  return `${flow.src} → ${flow.dst}:${flow.dport} TCP connection`
}

/**
 * The first data packet a custom flow sent, found in a trace (or null before it exists).
 * @param {any[]} events
 * @param {string} flowId
 */
export function firstPacketOfFlow(events, flowId) {
  const created = events.find((e) => e.type === 'packet.created' && e.flow === flowId && e.mirror_of == null)
  return created ? created.pid : null
}
