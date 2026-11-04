import { X } from 'lucide-react'

import { cableEnds, cableRole } from '../../scene/cableInfo.js'
import { useStore } from '../../state/store.js'
import { Button, Card, Chip } from '../../ui/index.js'

/** One end of the cable: the device, its interface and address, and a button that selects the device. */
function End({ title, end }) {
  const select = useStore((s) => s.select)
  return (
    <button type="button" className="neighbour" onClick={() => select(end.node.id)} title={`Select ${end.node.label}`}>
      <span className="neighbour__name">
        {title}: {end.node.label}
      </span>
      <span className="neighbour__meta mono">
        {end.iface}
        {end.address ? ` · ${end.address}` : ''}
      </span>
      <span className="neighbour__kind">{end.node.role}</span>
    </button>
  )
}

/**
 * The selected cable: which link of the logical topology it is and which two devices and interfaces it connects.
 * Everything comes from the topology data; no connection is invented. The source is the link's `a` end and the destination
 * its `b` end, exactly as the topology lists them (a cable itself has no direction).
 * @param {{linkId: string, topology: any}} props
 */
export function CablePanel({ linkId, topology }) {
  const selectCable = useStore((s) => s.selectCable)
  const ends = cableEnds(linkId, topology)
  if (!ends) return null
  const role = cableRole(ends.link)

  return (
    <Card
      eyebrow="Selected cable"
      title={`${ends.a.node.label} ↔ ${ends.b.node.label}`}
      actions={<Button size="small" variant="ghost" icon={<X size={14} />} onClick={() => selectCable(null)} aria-label="Clear the cable selection" title="Clear selection (Esc)" />}
    >
      <div className="chip-row">
        <Chip mono>{ends.link.id}</Chip>
        <Chip tone="accent">{ends.kindLabel}</Chip>
        {ends.link.kind === 'span' && <Chip tone="sensor">mirror copy only</Chip>}
      </div>
      <p className="muted device-description">{role}</p>

      <h3 className="panel-heading">Connection</h3>
      <ul className="neighbours">
        <li>
          <End title="Source" end={ends.a} />
        </li>
        <li>
          <End title="Destination" end={ends.b} />
        </li>
      </ul>
    </Card>
  )
}
