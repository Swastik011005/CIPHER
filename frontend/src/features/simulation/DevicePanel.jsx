import { Crosshair, X } from 'lucide-react'

import { describeInterfaces, neighboursOf, securityRole } from '../../scene/deviceInfo.js'
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

/**
 * Details of the selected device, taken from the topology.
 * @param {{node: any, topology: any}} props
 */
export function DevicePanel({ node, topology }) {
  const select = useStore((s) => s.select)
  const requestFocus = useStore((s) => s.requestFocus)
  const zone = topology.zones.find((z) => z.id === node.zone)
  const interfaces = describeInterfaces(node, topology)
  const neighbours = neighboursOf(node, topology)
  const role = securityRole(node)

  return (
    <Card
      eyebrow="Selected device"
      title={node.label}
      actions={
        <div className="panel-actions">
          <Button size="small" icon={<Crosshair size={14} />} onClick={() => requestFocus(node.id)} title="Move the camera to this device (F)">
            Focus
          </Button>
          <Button size="small" variant="ghost" icon={<X size={14} />} onClick={() => select(null)} aria-label="Clear selection" title="Clear selection (Esc)" />
        </div>
      }
    >
      <div className="chip-row">
        <Chip tone="accent">{TYPE_LABELS[node.type] ?? node.type}</Chip>
        {zone && <Chip>{zone.name}</Chip>}
        <Chip>
          <StatusDot tone="neutral" /> Idle · no simulation running
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
          <li key={n.linkId}>
            <button type="button" className="neighbour" onClick={() => select(n.peer.id)}>
              <span className="neighbour__name">{n.peer.label}</span>
              <span className="neighbour__meta mono">
                {n.linkId} · {n.localIface} ↔ {n.peerIface}
              </span>
              <span className="neighbour__kind">{n.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
