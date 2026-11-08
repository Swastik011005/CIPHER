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
export const BLOCKED_REASONS = Object.freeze(['fw_deny', 'acl_deny', 'ips_drop', 'ips_reject', 'blocked_source', 'rate_limited', 'edr_isolated', 'zt_deny'])

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
 * @property {{kind: 'allowed'|'flagged'|'blocked', t: number}|null} verdict  What an enforcement point decided, and when.
 * @property {{seq: number, t: number, type: string, node: string, tone: string, text: string}[]} trail  Decisions made about it.
 * @property {string|null} injectedBy  The device that created this packet out of thin air (IPS-1's reject reset), else null.
 */

/** A reset IPS-1 injects when it rejects a connection travels in a flow named `<original flow>:rst`. */
export const isInjectedReset = (e) => e.mirror_of == null && typeof e.flow === 'string' && e.flow.endsWith(':rst')

/** Verdict strength: a packet never goes back to a weaker verdict. */
const VERDICT_RANK = { allowed: 1, flagged: 2, blocked: 3 }

/** Counters kept for every device, shown in the device inspector. */
const NODE_KEYS = ['received', 'sent', 'delivered', 'dropped', 'permits', 'denies', 'inspected', 'flagged', 'alerts', 'actions', 'limited', 'mirrorsIn', 'mirrorsOut']


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
    // Campus security extension: what the EDR agents, the Zero Trust decision point and the SIEM reported in this run.
    edr: {},
    edrAlerts: [],
    zt: [],
    siem: [],
    packets: {},
    drops: {},
    nodes: {},
    ruleHits: {},
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
      if (isInjectedReset(e)) return `IPS-1 injected a TCP reset spoofed as ${e.src}:${e.sport} to ${e.dst}`
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
      if (e.action === 'reject' && e.applied) return `IPS-1 rejected #${e.pid} (${e.rule}) and sent a TCP reset`
      return `IPS-1 ${e.applied ? 'applied' : 'would apply'} ${e.action} to #${e.pid}${e.rule ? ` (${e.rule})` : ''}`
    case 'block.added':
      return `IPS-1 blocked ${e.src} until T+${e.until.toFixed(1)}s`
    case 'block.expired':
      return `Block on ${e.src} expired`
    case 'packet.delivered':
      return `#${e.pid} delivered to ${e.node}`
    case 'packet.dropped':
      return `#${e.pid} dropped at ${e.node}: ${e.reason}`
    case 'zt.decision':
      return `${e.pdp} ${e.decision === 'allow' ? 'allowed' : e.decision === 'deny' ? 'denied' : 'restricted'} ${e.device} (${e.role}) to ${e.resource} ${e.proto === 'icmp' ? 'ICMP' : `${e.proto.toUpperCase()}/${e.port}`}: ${e.reason}`
    case 'edr.alert':
      return `EDR ALERT ${e.severity.toUpperCase()} on ${e.node}: ${e.reason}`
    case 'edr.state':
      return `${e.node} is now ${e.state} (${e.cause === 'operator' ? 'operator action' : 'scenario'})`
    case 'siem.event':
      return `SIEM ${e.severity.toUpperCase()} from ${e.source}: ${e.reason}`
    case 'run.end':
      return 'Run finished'
    default:
      return e.type
  }
}

/** Events worth showing in the ticker (hops and routine inspections would flood it). */
const TICKER_TYPES = new Set(['zt.decision', 'edr.alert', 'edr.state', 'siem.event', 'alert.raised', 'ips.action', 'block.added', 'block.expired', 'packet.dropped', 'policy.decision', 'run.meta', 'run.end'])

/** Copy of `nodes` with one counter of one device increased (and its last-activity time set). */
function bumpNode(nodes, id, key, t) {
  const current = nodes[id] ?? Object.fromEntries([...NODE_KEYS.map((k) => [k, 0]), ['lastT', 0]])
  return { ...nodes, [id]: { ...current, [key]: current[key] + 1, lastT: t } }
}

/** Copy of `packet` with a stronger verdict and/or a new trail entry. */
function annotate(packet, e, { verdict = null, node, tone, text }) {
  const next = { ...packet, trail: [...packet.trail, { seq: e.seq, t: e.t, type: e.type, node, tone, text }] }
  if (verdict && (!packet.verdict || VERDICT_RANK[verdict] > VERDICT_RANK[packet.verdict.kind])) next.verdict = { kind: verdict, t: e.t }
  return next
}

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
        sport: e.sport,
        ttl: e.ttl,
        len: e.len,
        app: e.app,
        hops: [],
        end: null,
        flagged: false,
        verdict: null,
        trail: [],
        injectedBy: null,
      }
      if (isInjectedReset(e)) {
        record.injectedBy = 'IPS-1'
        record.verdict = { kind: 'blocked', t: e.t }
        record.trail = [{ seq: e.seq, t: e.t, type: e.type, node: 'IPS-1', tone: 'danger', text: `IPS-1 created this TCP reset, spoofed as ${e.src}, to end the rejected connection` }]
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
      const hop = { link: e.link, from: e.from, to: e.to, t: e.t, tArrive: e.t_arrive, vlan: e.vlan, ttl: e.ttl }
      next.packets = { ...state.packets, [e.pid]: { ...packet, hops: [...packet.hops, hop] } }
      const mirror = packet.mirrorOf != null
      next.nodes = bumpNode(bumpNode(state.nodes, e.from, mirror ? 'mirrorsOut' : 'sent', e.t), e.to, mirror ? 'mirrorsIn' : 'received', e.t)
      break
    }

    case 'inspect.result': {
      const packet = state.packets[e.pid]
      if (!packet) break
      const flagged = e.classification !== 'normal'
      const copy = packet.mirrorOf != null
      const text = flagged ? `${e.node} classified it ${e.classification} (${e.rules.join(', ')})` : `${e.node} inspected it: normal`
      const tone = flagged ? (e.classification === 'malicious' ? 'danger' : 'warn') : 'ok'
      // A verdict on a SPAN copy belongs to the sensor, never to the original packet's colour.
      const verdict = copy ? null : flagged ? 'flagged' : 'allowed'
      let updated = annotate(packet, e, { verdict, node: e.node, tone, text })
      if (flagged && !packet.flagged) updated = { ...updated, flagged: true }
      next.packets = { ...state.packets, [e.pid]: updated }
      next.nodes = bumpNode(state.nodes, e.node, 'inspected', e.t)
      if (flagged) next.nodes = bumpNode(next.nodes, e.node, 'flagged', e.t)
      break
    }

    case 'ips.action': {
      const packet = state.packets[e.pid]
      if (!packet) break
      const wouldAct = e.action !== 'allow'
      const text = wouldAct
        ? e.action === 'rate_limit'
          ? `${e.applied ? 'IPS-1 rate-limited it' : 'IPS-1 would rate-limit it (Monitor mode)'}: over the source's token bucket${e.rule ? ` · ${e.rule}` : ''}`
          : `${e.applied ? 'IPS-1 applied' : 'IPS-1 would apply (Monitor mode)'} ${e.action}${e.rule ? ` · ${e.rule}` : ''}`
        : 'IPS-1 allowed it'
      const tone = wouldAct ? (e.applied ? 'danger' : 'warn') : 'ok'
      let updated = annotate(packet, e, { verdict: wouldAct ? (e.applied ? 'blocked' : 'flagged') : null, node: 'IPS-1', tone, text })
      if (wouldAct && !e.applied && !packet.flagged) updated = { ...updated, flagged: true }
      next.packets = { ...state.packets, [e.pid]: updated }
      next.nodes = bumpNode(state.nodes, 'IPS-1', 'actions', e.t)
      break
    }

    case 'policy.decision': {
      const packet = state.packets[e.pid]
      const permit = e.action === 'permit'
      next.nodes = bumpNode(state.nodes, e.node, permit ? 'permits' : 'denies', e.t)
      const previous = state.ruleHits[e.rule_id]
      next.ruleHits = { ...state.ruleHits, [e.rule_id]: { ruleId: e.rule_id, node: e.node, policy: e.policy, action: e.action, count: (previous?.count ?? 0) + 1 } }
      if (!packet) break
      const text = `${e.node} ${permit ? 'permitted' : 'denied'} it · ${e.rule_id}${e.via_conntrack ? ' (return traffic)' : ''}`
      next.packets = { ...state.packets, [e.pid]: annotate(packet, e, { verdict: permit ? null : 'blocked', node: e.node, tone: permit ? 'ok' : 'danger', text }) }
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
      let ended = { ...packet, end }
      if (end.type === 'dropped' && packet.verdict?.kind !== 'blocked') ended = { ...ended, verdict: { kind: 'blocked', t: e.t } }
      next.packets = { ...state.packets, [e.pid]: ended }
      next.nodes = bumpNode(state.nodes, e.node, end.type, e.t)
      if (e.reason === 'rate_limited') next.nodes = bumpNode(next.nodes, e.node, 'limited', e.t)
      if (packet.mirrorOf == null) {
        next.counts = { ...state.counts }
        if (end.type === 'delivered') next.counts[packet.flagged ? 'delivered_flagged' : 'delivered_clean'] += 1
        else next.counts[BLOCKED_REASONS.includes(e.reason) ? 'blocked' : 'other_drop'] += 1
        if (end.type === 'dropped') next.drops = { ...state.drops, [e.reason]: (state.drops[e.reason] ?? 0) + 1 }
      }
      break
    }

    case 'alert.raised':
      next.alerts = [...state.alerts, e]
      next.nodes = bumpNode(state.nodes, e.sensor, 'alerts', e.t)
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

    case 'zt.decision': {
      next.zt = [...state.zt, e]
      const packet = state.packets[e.pid]
      if (!packet) break
      const tone = e.decision === 'allow' ? 'ok' : e.decision === 'restricted' ? 'warn' : 'danger'
      next.packets = { ...state.packets, [e.pid]: annotate(packet, e, { verdict: e.decision === 'deny' ? 'blocked' : null, node: e.pdp, tone, text: `${e.pdp} ${e.decision}: ${e.reason}` }) }
      break
    }

    case 'edr.alert':
      next.edrAlerts = [...state.edrAlerts, e]
      break

    case 'edr.state':
      next.edr = { ...state.edr, [e.node]: { state: e.state, since: e.t, cause: e.cause, reason: e.reason } }
      break

    case 'siem.event':
      next.siem = [...state.siem, e]
      break

    case 'run.end':
      next.finalStats = e.stats
      break

    default:
      break
  }

  const ticker = TICKER_TYPES.has(e.type) || (e.type === 'packet.created' && isInjectedReset(e))
  if (ticker && !(e.type === 'policy.decision' && e.action === 'permit')) {
    next.log = [...state.log, { seq: e.seq, t: e.t, type: e.type, text: describeEvent(e) }].slice(-LOG_LIMIT)
  }
  return next
}
