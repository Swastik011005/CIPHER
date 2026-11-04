import { Crosshair, Home, X } from 'lucide-react'

import { ZONE_PURPOSE, campusZone } from '../../scene/campus/campusLayout.js'
import { labelAddress } from '../../scene/deviceInfo.js'
import { useStore } from '../../state/store.js'
import { Button, Card, Chip } from '../../ui/index.js'

/**
 * The selected campus zone: what it is for and which devices it holds (the approved zone to device mapping, from the campus
 * layout). Choosing a device here selects it and moves the camera to it. The zone selection is independent of the device
 * selection, so this panel sits above the device panel instead of replacing it.
 * @param {{zoneId: string, topology: any}} props
 */
export function ZonePanel({ zoneId, topology }) {
  const selectZone = useStore((s) => s.selectZone)
  const requestZoneFocus = useStore((s) => s.requestZoneFocus)
  const requestPreset = useStore((s) => s.requestPreset)
  const select = useStore((s) => s.select)
  const requestFocus = useStore((s) => s.requestFocus)
  const zone = campusZone(zoneId)
  if (!zone) return null
  const logical = topology.zones.find((z) => z.id === zone.topologyZone)
  const subnet = logical?.vlan ? topology.subnets.find((s) => s.vlan === logical.vlan) : null
  const devices = zone.devices.map((id) => topology.nodes.find((n) => n.id === id)).filter(Boolean)

  return (
    <Card
      eyebrow="Selected zone"
      title={zone.name}
      actions={
        <div className="panel-actions">
          <Button size="small" icon={<Crosshair size={14} />} onClick={() => requestZoneFocus(zone.id)} title="Move the camera to this zone (or double-click it)">
            Focus
          </Button>
          <Button size="small" variant="ghost" icon={<Home size={14} />} onClick={() => requestPreset('overview')} aria-label="Back to the overview" title="Back to the overview (key R)" />
          <Button size="small" variant="ghost" icon={<X size={14} />} onClick={() => selectZone(null)} aria-label="Clear the zone selection" title="Clear the zone (click the ground)" />
        </div>
      }
    >
      <div className="chip-row">
        {logical?.vlan ? <Chip tone="accent">VLAN {logical.vlan}</Chip> : <Chip>No VLAN</Chip>}
        {subnet && <Chip mono>{subnet.cidr}</Chip>}
        <Chip>{devices.length} {devices.length === 1 ? 'device' : 'devices'}</Chip>
      </div>
      <p className="device-description">{ZONE_PURPOSE[zone.id]}</p>

      <h3 className="panel-heading">Devices in this zone</h3>
      <ul className="neighbours">
        {devices.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              className="neighbour"
              onClick={() => {
                select(node.id)
                requestFocus(node.id)
              }}
            >
              <span className="neighbour__name">{node.label}</span>
              <span className="neighbour__meta mono">{labelAddress(node)}</span>
              <span className="neighbour__kind">{node.role}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
