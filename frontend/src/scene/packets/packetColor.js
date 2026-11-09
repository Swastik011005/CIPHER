/**
 * Which colour a packet is drawn in at playhead time `t`.
 *
 * Packets are neutral until an enforcement point decides: IPS-1 inspecting them (allowed or
 * flagged), the firewall or ACL denying them, or an IPS action. The change blends over a short
 * fade so a verdict reads as a transition, not a flicker. SPAN copies are always violet: IDS-1's
 * verdict never recolours the original packet.
 *
 * ICMP echo packets (a ping) are the exception: each of the four attempts of a ping has its own colour, which it keeps for its whole
 * journey (request and reply alike), so the attempts can be told apart. A verdict shows on a ping envelope as a mark and on the cable,
 * never as a change of the envelope's colour.
 */

/** Seconds a verdict takes to blend in. */
export const VERDICT_FADE_S = 0.25

const TARGET = { allowed: 'allowed', flagged: 'flagged', blocked: 'dropped' }

/** The four colours of a ping, by attempt: cyan blue, purple, amber, green. */
export const PING_COLOURS = Object.freeze(['#38BDF8', '#A78BFA', '#F59E0B', '#34D399'])

/** The colour of an ICMP echo request or reply, by its sequence number (1, 2, 3, 4, 1, ...). */
export function pingColour(seq) {
  return PING_COLOURS[(((seq ?? 1) - 1) % PING_COLOURS.length + PING_COLOURS.length) % PING_COLOURS.length]
}

/** Whether a packet is an ICMP echo request (type 8) or reply (type 0) that is not a SPAN copy: it is drawn as a coloured envelope. */
export function isPingPacket(packet) {
  return packet.mirrorOf == null && packet.proto === 'icmp' && packet.icmp != null && (packet.icmp.type === 8 || packet.icmp.type === 0)
}

/**
 * @param {{mirrorOf: number|null, verdict: {kind: string, t: number}|null}} packet  A reducer packet record.
 * @param {number} t
 * @returns {{key: string, from: string, u: number}}  Colour key, the key it blends from and the blend (0..1).
 */
export function packetColorAt(packet, t) {
  if (packet.mirrorOf != null) return { key: 'mirror', from: 'mirror', u: 1 }
  if (!packet.verdict) return { key: 'neutral', from: 'neutral', u: 1 }
  const key = TARGET[packet.verdict.kind]
  const u = Math.min(Math.max((t - packet.verdict.t) / VERDICT_FADE_S, 0), 1)
  return { key, from: 'neutral', u }
}
