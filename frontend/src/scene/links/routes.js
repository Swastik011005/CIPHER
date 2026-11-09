/**
 * The complete route of every packet of a loaded trace, known before the packet gets there: the trace holds every hop event, so the
 * links a packet will cross are read from the whole event list, not only from the part the playhead has reached. A blocked packet's
 * route ends at the device that stopped it, because the trace has no hop beyond it.
 */
const cache = new WeakMap()

/**
 * @param {{type: string, pid?: number, link?: string}[]} events  The loaded trace.
 * @returns {Map<number, string[]>}  Link ids in travel order, by packet id.
 */
export function routesOf(events) {
  let routes = cache.get(events)
  if (!routes) {
    routes = new Map()
    for (const e of events) {
      if (e.type !== 'packet.hop') continue
      const list = routes.get(e.pid)
      if (list) list.push(e.link)
      else routes.set(e.pid, [e.link])
    }
    cache.set(events, routes)
  }
  return routes
}
