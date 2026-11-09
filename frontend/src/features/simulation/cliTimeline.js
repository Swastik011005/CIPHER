/**
 * What an endpoint terminal shows for a command whose packets are replayed in the 3D campus.
 *
 * The backend returns every line of a command's output together with the moment of the run at which it belongs (`timeline`: the time
 * a reply reached the source, a request timed out, the statistics were complete). The terminal prints a line only when the playhead
 * has reached that time, so a "Reply from" line appears when the envelope that carries the reply gets back to the source, never
 * earlier and never from a front-end timer. Pausing, scrubbing and changing the playback speed all move the lines with the animation.
 * If the run is stopped or replaced, the lines printed so far stay and the rest never appear.
 */

/** Lines that are not tied to a packet come first and at once; a timeline always has one time per line. */
export function visibleLines(entry, live) {
  if (entry.frozen) return entry.frozen
  if (!entry.timeline || !entry.animated) return entry.lines
  const mine = live != null && live.token === entry.token
  if (!mine) return entry.lines // a finished run that is no longer loaded: the command completed, show it all
  if (live.finished) return entry.lines
  return entry.lines.filter((_, i) => entry.timeline[i] <= live.time + 1e-9)
}

/** Whether the command's output is still being printed (its run is loaded, playing or paused, and not finished). */
export function isRunning(entry, live) {
  return Boolean(entry.timeline && entry.animated && !entry.frozen && live != null && live.token === entry.token && !live.finished)
}

/**
 * The lines of an interrupted command: what was already printed, then the interruption and, for a ping, the statistics of what had
 * really happened (requests sent and replies received up to the playhead).
 * @param {{input: string, lines: string[], timeline: number[]}} entry
 * @param {number} time  The playhead when the command was stopped.
 * @param {{sent: number, received: number}|null} counts  For a ping.
 */
export function interruptedLines(entry, time, counts) {
  const printed = entry.lines.filter((_, i) => entry.timeline[i] <= time + 1e-9)
  const out = [...printed, '^C']
  if (counts && /^ping\b/i.test(entry.input)) {
    const lost = Math.max(0, counts.sent - counts.received)
    out.push('', `Packets: Sent = ${counts.sent}, Received = ${counts.received}, Lost = ${lost} (interrupted)`)
  }
  return out
}
