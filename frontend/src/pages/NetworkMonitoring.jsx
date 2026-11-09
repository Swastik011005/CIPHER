import { Suspense, lazy, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { LOG_FILTERS, deviceRows, eventLog, kpis } from '../playback/monitoring.js'
import { session } from '../playback/session.js'
import { labelAddress, linkVlanLabel } from '../scene/deviceInfo.js'
import { useStore } from '../state/store.js'
import { Banner, Card, Chip, KpiTile, Segmented, Spinner } from '../ui/index.js'
import './pages.css'

// the charts library is loaded only when a run is on this page
const MonitoringCharts = lazy(() => import('../features/monitoring/MonitoringCharts.jsx'))

const DROP_LABELS = {
  fw_deny: 'FW1 deny',
  acl_deny: 'ACL deny',
  ips_drop: 'IPS drop',
  ips_reject: 'IPS reject',
  rate_limited: 'IPS rate limit',
  blocked_source: 'Blocked source',
  ttl_expired: 'TTL expired',
  no_route: 'No route',
}
const TAG_TONE = { ok: 'ok', warn: 'warn', danger: 'danger', sensor: 'sensor', info: 'info' }

/** Page 3: inventory of the simulated network. Live traffic metrics need a running simulation. */
export function NetworkMonitoring() {
  const topology = useStore((s) => s.topology)
  const select = useStore((s) => s.select)
  const requestFocus = useStore((s) => s.requestFocus)
  const navigate = useNavigate()
  const data = topology.data
  const run = useStore((s) => s.run)
  const state = useStore((s) => s.playback.state)
  const time = useStore((s) => s.playback.time)
  const [filter, setFilter] = useState('security')
  const rows = useMemo(() => (data && state?.meta ? deviceRows(data, state) : []), [data, state])
  const log = useMemo(
    () => (state?.meta && session.player ? eventLog(session.player.events, state.cursor, filter) : []),
    // `state` changes with every applied event, which is exactly when the log can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, filter],
  )

  const openInScene = (id) => {
    select(id)
    requestFocus(id)
    navigate('/simulation')
  }

  return (
    <div className="page">
      {!state?.meta ? (
        <Banner tone="info" title="No traffic to monitor yet">
          Packet counters, per-device activity and the event log appear here once a scenario plays in the simulation. Until
          then this page lists the devices and links that will be measured, straight from the engine&apos;s topology.
        </Banner>
      ) : (
        <>
          <Banner tone="info" title={`Run ${run.meta?.scenario_id} · IPS ${run.meta?.ips_mode} · T+${time.toFixed(1)} s`}>
            These figures are folded from the same trace as the 3D scene, up to the playhead, so they equal the Simulation
            page&apos;s counters at every moment and the engine&apos;s own totals at the end.
          </Banner>
          <div className="grid grid--4" aria-label="Packet counters">
            {kpis(state.counts).map((k) => (
              <Card key={k.key}>
                <KpiTile label={k.label} value={k.value} hint={k.hint} />
              </Card>
            ))}
          </div>

          <Suspense fallback={<Card><div className="inline-status"><Spinner /> <span className="muted">Loading the charts…</span></div></Card>}>
            <MonitoringCharts state={state} duration={run.meta?.duration ?? 1} time={time} topology={data} />
          </Suspense>

          <Card eyebrow="Enforcement" title="Why packets were stopped">
            {Object.keys(state.drops).length === 0 ? (
              <p className="muted">No packet has been stopped yet at this point in the run.</p>
            ) : (
              <div className="chip-row">
                {Object.entries(state.drops).map(([reason, count]) => (
                  <Chip key={reason} tone={reason === 'ttl_expired' || reason === 'no_route' ? 'neutral' : 'danger'}>
                    {DROP_LABELS[reason] ?? reason} · {count}
                  </Chip>
                ))}
              </div>
            )}
          </Card>

          <Card eyebrow="Devices" title="Activity at the playhead">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Type</th>
                    <th>Sent</th>
                    <th>Received</th>
                    <th>Delivered</th>
                    <th>Dropped</th>
                    <th>Permit / deny</th>
                    <th>Alerts</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="row-link" onClick={() => openInScene(r.id)}>
                      <td>{r.label}</td>
                      <td>{r.type}</td>
                      <td className="mono">{r.sent}</td>
                      <td className="mono">{r.received}</td>
                      <td className="mono">{r.delivered}</td>
                      <td className="mono">{r.dropped}</td>
                      <td className="mono">{r.permits || r.denies ? `${r.permits} / ${r.denies}` : '–'}</td>
                      <td className="mono">{r.alerts}</td>
                      <td>
                        <div className="chip-row">
                          {r.tags.map((t) => (
                            <Chip key={t.text} tone={TAG_TONE[t.tone]}>
                              {t.text}
                            </Chip>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card eyebrow="Events" title="Event log" actions={<Segmented label="Event filter" value={filter} onChange={setFilter} options={LOG_FILTERS.map((f) => ({ value: f.value, label: f.label }))} />}>
            {log.length === 0 ? (
              <p className="muted">Nothing of this kind has happened yet at the playhead.</p>
            ) : (
              <div className="table-scroll">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>T+</th>
                      <th>Event</th>
                      <th>What happened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((e) => (
                      <tr key={e.seq}>
                        <td className="mono">{e.t.toFixed(2)}</td>
                        <td className="mono">{e.type}</td>
                        <td>{e.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted">Newest first, the latest {log.length} matching events. The whole trace is replayed from the engine, not sampled.</p>
          </Card>
        </>
      )}

      {!data && (
        <Card>
          <div className="inline-status">
            {topology.status === 'error' ? (
              <span>Topology unavailable: {topology.error}</span>
            ) : (
              <>
                <Spinner /> <span className="muted">Waiting for the topology from the engine…</span>
              </>
            )}
          </div>
        </Card>
      )}

      {data && (
        <>
          <Card eyebrow="Devices" title={`${data.summary.devices} devices and the Internet segment`}>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Type</th>
                    <th>Zone</th>
                    <th>Address</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {data.nodes.map((node) => (
                    <tr key={node.id} className="row-link" onClick={() => openInScene(node.id)}>
                      <td>
                        <button type="button" className="link-button" onClick={(e) => { e.stopPropagation(); openInScene(node.id) }}>
                          {node.label}
                        </button>
                      </td>
                      <td>{node.type}</td>
                      <td>{data.zones.find((z) => z.id === node.zone)?.name}</td>
                      <td className="mono">{labelAddress(node)}</td>
                      <td className="muted">{node.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card eyebrow="Links" title={`${data.summary.links} links`}>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Link</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Kind</th>
                    <th>Layer 2</th>
                  </tr>
                </thead>
                <tbody>
                  {data.links.map((link) => (
                    <tr key={link.id}>
                      <td className="mono">{link.id}</td>
                      <td className="mono">{link.a.node}:{link.a.iface}</td>
                      <td className="mono">{link.b.node}:{link.b.iface}</td>
                      <td>
                        <Chip tone={link.kind === 'span' ? 'sensor' : 'neutral'}>{link.kind}</Chip>
                      </td>
                      <td className="muted">{linkVlanLabel(link)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
