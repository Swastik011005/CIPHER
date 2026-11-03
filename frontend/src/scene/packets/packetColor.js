/**
 * Which colour a packet is drawn in at playhead time `t`.
 *
 * Packets are neutral until an enforcement point decides: IPS-1 inspecting them (allowed or
 * flagged), the firewall or ACL denying them, or an IPS action. The change blends over a short
 * fade so a verdict reads as a transition, not a flicker. SPAN copies are always violet: IDS-1's
 * verdict never recolours the original packet.
 */

/** Seconds a verdict takes to blend in. */
export const VERDICT_FADE_S = 0.25

const TARGET = { allowed: 'allowed', flagged: 'flagged', blocked: 'dropped' }

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
