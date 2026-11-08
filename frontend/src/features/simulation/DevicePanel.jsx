import { Box, Crosshair, X } from 'lucide-react'
import { useMemo } from 'react'

import { deviceInspector } from '../../playback/inspectors.js'
import { describeInterfaces, neighboursOf, primaryAddress, securityRole } from '../../scene/deviceInfo.js'
import { useStore } from '../../state/store.js'
import { Button, Card, Chip, StatusDot } from '../../ui/index.js'

const TYPE_LABELS = {
  host: 'Host',
  router: 'Router',
  l3switch: 'Layer 3 switch',
  l2switch: 'Layer 2 switch',
  firewall: 'Firewall',
  ids: 'IDS sensor',
  ips: 'IPS',
  syslog: 'Syslog collector',
  segment: 'Network segment',
}

/** Live counters, rule hits, alerts and blocks for this device at the playhead. */
function LiveSection({ live, node }) {
  return (
    <>
      <h3 className="panel-heading">Live at the playhead</h3>
      <dl className="stat-grid">
        {live.counters.map((c) => (
          <div key={c.key} className="stat-grid__item">
            <dt>{c.label}</dt>
            <dd className="mono">{c.value}</dd>
          </div>
        ))}
      </dl>

      {live.rules.length > 0 && (
        <>
          <h3 className="panel-heading">Policy rules hit</h3>
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Action</th>
                <th>Hits</th>
              </tr>
            </thead>
            <tbody>
              {live.rules.map((r) => (
                <tr key={r.ruleId}>
                  <td className="mono">{r.ruleId}</td>
                  <td>
                    <Chip tone={r.action === 'permit' ? 'ok' : 'danger'}>{r.action}</Chip>
                  </td>
                  <td className="mono">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {live.alerts.length > 0 && (
        <>
          <h3 className="panel-heading">{node.id} alerts</h3>
          <ul className="event-list">
            {live.alerts.map((a) => (
              <li key={a.alert_id}>
                <Chip tone={a.severity === 'high' ? 'danger' : 'warn'}>{a.severity}</Chip>
                <span className="mono">T+{a.t.toFixed(1)}</span>
                <span>
                  {a.rule}: {a.reason}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {live.blocks.length > 0 && (
        <>
          <h3 className="panel-heading">Active blocks (IPS-1)</h3>
          <ul className="event-list">
            {live.blocks.map((b) => (
              <li key={b.src}>
                <Chip tone="danger">blocked</Chip>
                <span className="mono">{b.src}</span>
                <span>{b.remaining.toFixed(1)} s left · {b.rule}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/**
 * Details of the selected device, taken from the topology and, while a run is loaded, from the trace.
 * @param {{node: any, topology: any}} props
 */
export function DevicePanel({ node, topology, tabs = null, hideDetails = false, children = null }) {
  const select = useStore((s) => s.select)
  const requestFocus = useStore((s) => s.requestFocus)
  const openInspector = useStore((s) => s.openInspector)
  const selectCable = useStore((s) => s.selectCable)
  const zone = topology.zones.find((z) => z.id === node.zone)
  const interfaces = describeInterfaces(node, topology)
  const neighbours = neighboursOf(node, topology)
  const role = securityRole(node)
  const state = useStore((s) => s.playback.state)
  const time = useStore((s) => s.playback.time)
  const address = primaryAddress(node)?.split('/')[0] ?? null
  const live = useMemo(() => (state?.meta ? deviceInspector(node, address, state, time) : null), [node, address, state, time])

  return (
    <Card
      eyebrow="Selected device"
      title={node.label}
      actions={
        <div className="panel-actions">
          <Button size="small" icon={<Crosshair size={14} />} onClick={() => requestFocus(node.id)} title="Move the camera to this device (F)">
            Focus
          </Button>
          <Button size="small" icon={<Box size={14} />} onClick={() => openInspector(node.id)} title="Open the device in the 3D viewer (key I, or double-click the device)">
            Inspect
          </Button>
          <Button size="small" variant="ghost" icon={<X size={14} />} onClick={() => select(null)} aria-label="Clear selection" title="Clear selection (Esc)" />
        </div>
      }
    >
      {tabs}
      {hideDetails ? (
        children
      ) : (
      <>
      <div className="chip-row">
        <Chip tone="accent">{TYPE_LABELS[node.type] ?? node.type}</Chip>
        {zone && <Chip>{zone.name}</Chip>}
        <Chip>
          <StatusDot tone={live?.status.tone ?? 'neutral'} /> {live?.status.text ?? 'Idle · no simulation running'}
        </Chip>
      </div>

      <p className="device-role">{node.role}</p>
      <p className="muted device-description">{node.description}</p>

      {role && (
        <div className={`callout callout--${role.tone}`}>
          <strong>{role.title}</strong>
          <span>{role.text}</span>
        </div>
      )}

      {live && <LiveSection live={live} node={node} />}

      <h3 className="panel-heading">Interfaces</h3>
      <table className="table table--compact">
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Attachment</th>
          </tr>
        </thead>
        <tbody>
          {interfaces.map((i) => (
            <tr key={i.name}>
              <td className="mono">{i.name}</td>
              <td className="mono">{i.address ?? '—'}</td>
              <td>{i.attachment}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {node.services.length > 0 && (
        <>
          <h3 className="panel-heading">Services</h3>
          <div className="chip-row">
            {node.services.map((s) => (
              <Chip key={`${s.proto}${s.port}`} mono title={s.encrypted ? 'Encrypted' : 'Plain text'}>
                {s.proto}/{s.port} {s.name}
              </Chip>
            ))}
          </div>
        </>
      )}

      <h3 className="panel-heading">Connected to</h3>
      <ul className="neighbours">
        {neighbours.map((n) => (
          <li key={n.linkId} className="neighbour-row">
            <button type="button" className="neighbour" onClick={() => select(n.peer.id)}>
              <span className="neighbour__name">{n.peer.label}</span>
              <span className="neighbour__meta mono">
                {n.linkId} · {n.localIface} ↔ {n.peerIface}
              </span>
              <span className="neighbour__kind">{n.label}</span>
            </button>
            <Button size="small" variant="ghost" onClick={() => selectCable(n.linkId)} title={`Show the cable ${n.linkId} in the scene and in the panel`}>
              Cable {n.linkId}
            </Button>
          </li>
        ))}
      </ul>
      </>
      )}
    </Card>
  )
}
