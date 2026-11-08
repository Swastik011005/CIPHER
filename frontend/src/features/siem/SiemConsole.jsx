import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../api/client.js'
import { siemIncidents } from '../../playback/securityView.js'
import { useStore } from '../../state/store.js'
import { Banner, Card, Chip, EmptyState, Segmented } from '../../ui/index.js'

const NONE = Object.freeze([]) // a stable empty list: a selector must not build a new array on every call
const SEVERITY_TONE = { low: 'info', medium: 'warn', high: 'danger' }
const SOURCE_NOTE = {
  FW1: 'Perimeter firewall: static policy',
  'CORE-SW1': 'Core switch: STAFF-IN ACL',
  'IDS-1': 'Passive sensor: alerts only, never blocks',
  'IPS-1': 'Inline prevention point',
  EDR: 'Endpoint agent, reporting to EDR-MGMT-1',
  'ZERO-TRUST': 'Zero Trust decision point ZT-POLICY-1',
}
const VIEWS = [
  { value: 'run', label: 'This run', title: 'The events of the loaded run, up to the playhead' },
  { value: 'history', label: 'History', title: 'Every event the SIEM received in runs on this server' },
]

/** One event in full: where it came from, what it was about, what was done and which event of the trace it refers to. */
function EventDetail({ event }) {
  const rows = [
    ['Event', event.event_id],
    ['Time', `T+${event.t.toFixed(2)} s (simulated)`],
    ['Source component', `${event.source} · ${SOURCE_NOTE[event.source] ?? ''}`],
    ['Kind', event.kind],
    ['Affected device', event.node],
    ['From → to', event.src ? `${event.src} → ${event.dst}${event.dport ? `:${event.dport}` : ''} ${event.proto?.toUpperCase() ?? ''}` : '—'],
    ['Reason', event.reason],
    ['Response', event.action],
    ['Incident', event.incident_id],
    ['Origin in the trace', `${event.origin_type} ${event.origin_ref ?? ''}`],
  ]
  return (
    <dl className="kv siem-detail" aria-label={`Details of ${event.event_id}`}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="mono">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The simulated SIEM console: a timeline of the events SIEM-1 received (each from the component that really produced it), and the
 * incidents that connect them. Everything shown is synthetic telemetry from the deterministic simulation.
 */
export function SiemConsole() {
  const live = useStore((s) => s.playback.state?.siem ?? NONE)
  const loaded = useStore((s) => s.playback.state?.meta != null)
  const [view, setView] = useState('run')
  const [history, setHistory] = useState({ events: [], error: null })
  const [open, setOpen] = useState(null)
  const [incident, setIncident] = useState(null)

  const loadHistory = useCallback(() => {
    api.siemEvents().then((d) => setHistory({ events: d.events, error: null })).catch((e) => setHistory((h) => ({ ...h, error: e.message })))
  }, [])
  useEffect(() => {
    if (view === 'history') loadHistory()
  }, [view, loadHistory])

  const events = view === 'run' ? live : history.events
  const incidents = useMemo(() => siemIncidents(events), [events])
  const shown = incident ? events.filter((e) => e.incident_id === incident) : events
  const chosen = events.find((e) => e.event_id === open) ?? null

  return (
    <Card eyebrow="SIEM" title="SIEM-1 event console" actions={<Segmented label="SIEM view" value={view} onChange={(v) => { setView(v); setOpen(null); setIncident(null) }} options={VIEWS} />}>
      <p className="muted device-description">
        SIEM-1 receives simulated events from FW1, CORE-SW1, IDS-1, IPS-1, EDR and the Zero Trust decision point, only when that component really took part in the run, and groups the events about one device into incidents. Synthetic telemetry only.
      </p>
      {view === 'history' && history.error && <Banner tone="danger" title="Cannot load the SIEM history">{history.error}</Banner>}
      {events.length === 0 ? (
        <EmptyState title={view === 'run' ? (loaded ? 'No SIEM event yet' : 'No run loaded') : 'The SIEM history is empty'}>
          {view === 'run' ? 'Run one of the nine scenarios, for example scenario 7 or 9, and the events appear here as they happen.' : 'Events are kept here after each run on this server.'}
        </EmptyState>
      ) : (
        <>
          <h3 className="panel-heading">Incidents</h3>
          <ul className="event-list siem-incidents">
            {incidents.map((inc) => (
              <li key={inc.id}>
                <button type="button" className="neighbour" aria-pressed={incident === inc.id} onClick={() => setIncident(incident === inc.id ? null : inc.id)}>
                  <span className="neighbour__name">
                    <Chip tone={SEVERITY_TONE[inc.severity]}>{inc.severity}</Chip> <span className="mono">{inc.id}</span> · {inc.node}
                  </span>
                  <span className="neighbour__meta mono">
                    {inc.events.length} event{inc.events.length === 1 ? '' : 's'} · T+{inc.firstT.toFixed(1)} to T+{inc.lastT.toFixed(1)} s · {inc.sources.join(' + ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <h3 className="panel-heading">{incident ? `Timeline of ${incident}` : 'Event timeline'}</h3>
          <table className="table table--compact siem-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Severity</th>
                <th>Source</th>
                <th>Device</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.event_id} className={open === e.event_id ? 'is-open' : ''} onClick={() => setOpen(open === e.event_id ? null : e.event_id)} tabIndex={0} onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && setOpen(open === e.event_id ? null : e.event_id)}>
                  <td className="mono">T+{e.t.toFixed(1)}</td>
                  <td><Chip tone={SEVERITY_TONE[e.severity]}>{e.severity}</Chip></td>
                  <td><strong>{e.source}</strong></td>
                  <td className="mono">{e.node}</td>
                  <td>{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {chosen && <EventDetail event={chosen} />}
        </>
      )}
    </Card>
  )
}
