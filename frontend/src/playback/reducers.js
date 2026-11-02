/**
 * Trace reducers: fold engine events into the state the UI shows.
 *
 * The counters use the same definitions as backend/netsec/analysis/stats.py: only data-plane
 * packets count, SPAN copies are `mirrored`, and every data packet ends in exactly one outcome
 * bucket. A test replays whole traces and checks the result equals the engine's `run.end` stats,
 * so the dashboard cannot disagree with the engine.
 *
 * `applyEvent` never mutates its input, which is what lets `seek` rebuild any past state.
 */

/** Drop reasons that count as `blocked` (policy decisions); the rest are `other_drop`. */
export const BLOCKED_REASONS = Object.freeze(['fw_deny', 'acl_deny', 'ips_drop', 'ips_reject', 'blocked_source', 'rate_limited'])

const LOG_LIMIT = 60

/**
 * @typedef {Object} PacketRecord
 * @property {number} pid
 * @property {string} flow
 * @property {'tcp'|'udp'|'icmp'} proto
 * @property {string} src
 * @property {string} dst
 * @property {number|null} dport
 * @property {string[]} flags
 * @property {number|null} mirrorOf
 * @property {number} createdAt
 * @property {{link: string, from: string, to: string, t: number, tArrive: number, vlan: number|null}[]} hops
 * @property {{type: 'delivered'|'dropped', node: string, reason: string|null, t: number}|null} end
 * @property {boolean} flagged   A sensor on the packet's own path judged it suspicious or malicious.
 */

export function initialState() {
  return {
    meta: null,
    counts: {
      data_packets: 0,
      delivered_clean: 0,
      delivered_flagged: 0,
      blocked: 0,
      other_drop: 0,
      mirrored: 0,
      management: 0,
      alerts: 0,
      incidents: 0,
    },
    incidentIds: [],
    alerts: [],
    blocks: {},
    packets: {},
    log: [],
    finalStats: null,
    cursor: 0,
  }
}

/** One plain-English line for the event ticker. */
export function describeEvent(e) {
  switch (e.type) {
    case 'run.meta':
      return `Run ${e.scenario_id} started (IPS ${e.ips_mode})`
    case 'packet.created':
      return e.mirror_of == null
        ? `${e.src} → ${e.dst}${e.dport != null ? `:${e.dport}` : ''} ${e.proto.toUpperCase()} ${e.flags.join('+')}`.trim()
        : `SPAN copy of #${e.mirror_of}`
    case 'packet.mirrored':
      return `${e.at} mirrored #${e.pid} to ${e.to}`
    case 'policy.decision':
      return `${e.node} ${e.action === 'permit' ? 'permitted' : 'denied'} #${e.pid} (${e.rule_id})`
    case 'inspect.result':
      return e.classification === 'normal' ? `${e.node} inspected #${e.pid}: normal` : `${e.node} flagged #${e.pid} as ${e.classification} (${e.rules.join(', ')})`
    case 'alert.raised':
      return `${e.sensor} ALERT ${e.severity.toUpperCase()} ${e.rule}: ${e.reason}`
    case 'ips.action':
      return `IPS-1 ${e.applied ? 'applied' : 'would apply'} ${e.action} to #${e.pid}`
    case 'block.added':
      return `IPS-1 blocked ${e.src} until T+${e.until.toFixed(1)}s`
    case 'block.expired':
      return `Block on ${e.src} expired`
    case 'packet.delivered':
      return `#${e.pid} delivered to ${e.node}`
    case 'packet.dropped':
      return `#${e.pid} dropped at ${e.node}: ${e.reason}`
    case 'run.end':
      return 'Run finished'
    default:
      return e.type
  }
}

/** Events worth showing in the ticker (hops and routine inspections would flood it). */
const TICKER_TYPES = new Set(['alert.raised', 'ips.action', 'block.added', 'block.expired', 'packet.dropped', 'policy.decision', 'run.meta', 'run.end'])

/**
 * Apply one event. Returns a new state.
 * @param {ReturnType<typeof initialState>} state
 * @param {any} e
 */
export function applyEvent(state, e) {
  const next = { ...state, cursor: state.cursor + 1 }

  switch (e.type) {
    case 'run.meta':
      next.meta = e
      break

    case 'packet.created': {
      const record = {
        pid: e.pid,
        flow: e.flow,
        proto: e.proto,
        src: e.src,
        dst: e.dst,
        dport: e.dport,
        flags: e.flags,
        mirrorOf: e.mirror_of,
        createdAt: e.t,
        hops: [],
        end: null,
        flagged: false,
      }
      next.packets = { ...state.packets, [e.pid]: record }
      next.counts = { ...state.counts }
      if (e.mirror_of == null) next.counts.data_packets += 1
      else next.counts.mirrored += 1
      break
    }

    case 'packet.hop': {
      const packet = state.packets[e.pid]
      if (!packet) break
      const hop = { link: e.link, from: e.from, to: e.to, t: e.t, tArrive: e.t_arrive, vlan: e.vlan }
      next.packets = { ...state.packets, [e.pid]: { ...packet, hops: [...packet.hops, hop] } }
      break
    }

    case 'inspect.result':
    case 'ips.action': {
      const flags =
        e.type === 'inspect.result' ? e.classification !== 'normal' : e.action !== 'allow' && !e.applied
      const packet = state.packets[e.pid]
      if (flags && packet && !packet.flagged) next.packets = { ...state.packets, [e.pid]: { ...packet, flagged: true } }
      break
    }

    case 'packet.delivered':
    case 'packet.dropped': {
      const packet = state.packets[e.pid]
      if (!packet) break
      const end = {
        type: e.type === 'packet.delivered' ? 'delivered' : 'dropped',
        node: e.node,
        reason: e.reason ?? null,
        t: e.t,
      }
      next.packets = { ...state.packets, [e.pid]: { ...packet, end } }
      if (packet.mirrorOf == null) {
        next.counts = { ...state.counts }
        if (end.type === 'delivered') next.counts[packet.flagged ? 'delivered_flagged' : 'delivered_clean'] += 1
        else next.counts[BLOCKED_REASONS.includes(e.reason) ? 'blocked' : 'other_drop'] += 1
      }
      break
    }

    case 'alert.raised':
      next.alerts = [...state.alerts, e]
      next.counts = { ...state.counts, alerts: state.counts.alerts + 1 }
      if (!state.incidentIds.includes(e.incident_id)) {
        next.incidentIds = [...state.incidentIds, e.incident_id]
        next.counts.incidents = next.incidentIds.length
      }
      break

    case 'block.added':
      next.blocks = { ...state.blocks, [e.src]: { src: e.src, until: e.until, rule: e.rule, incidentId: e.incident_id, since: e.t } }
      break

    case 'block.expired': {
      const { [e.src]: _gone, ...rest } = state.blocks
      next.blocks = rest
      break
    }

    case 'run.end':
      next.finalStats = e.stats
      break

    default:
      break
  }

  if (TICKER_TYPES.has(e.type) && !(e.type === 'policy.decision' && e.action === 'permit')) {
    next.log = [...state.log, { seq: e.seq, t: e.t, type: e.type, text: describeEvent(e) }].slice(-LOG_LIMIT)
  }
  return next
}
