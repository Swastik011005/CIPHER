import { Eye, ShieldCheck, ShieldOff } from 'lucide-react'

import { useStore } from '../state/store.js'
import { Banner, Card, Chip, EmptyState } from '../ui/index.js'
import './pages.css'

/** Page 4: where detections and prevention actions will appear. Nothing is detected yet. */
export function ThreatCentre() {
  const topology = useStore((s) => s.topology.data)
  const span = topology?.span
  const ids = topology?.nodes.find((n) => n.id === span?.sensor)
  const ips = topology?.nodes.find((n) => n.type === 'ips')

  return (
    <div className="page">
      <Banner tone="info" title="No detections yet">
        Intrusion detection and prevention are not implemented in this stage, so no alerts or incidents are produced. The
        roles of the two sensors are fixed by the topology and shown below.
      </Banner>

      <div className="grid grid--2">
        <Card eyebrow="Detection" title="IDS-1: passive sensor" actions={<Chip tone="sensor">Alerts only</Chip>}>
          <div className="role">
            <Eye size={20} aria-hidden="true" />
            <div>
              <p>{ids?.description ?? 'Loading from the topology…'}</p>
              {span && (
                <dl className="kv role__facts">
                  <dt>Fed by</dt>
                  <dd className="mono">
                    {span.node} ingress SPAN over {span.destination_link}
                  </dd>
                  <dt>Not mirrored</dt>
                  <dd className="mono">VLAN {span.exclude_vlans.join(', ')}</dd>
                  <dt>Can block</dt>
                  <dd>No. It is not in the traffic path.</dd>
                </dl>
              )}
            </div>
          </div>
        </Card>

        <Card eyebrow="Prevention" title="IPS-1: inline" actions={<Chip tone="accent">Can block</Chip>}>
          <div className="role">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <p>{ips?.description ?? 'Loading from the topology…'}</p>
              {ips && (
                <dl className="kv role__facts">
                  <dt>Position</dt>
                  <dd>Transparent bridge for VLAN {ips.bridge?.vlan}, between CORE-SW1 and SRV-SW3</dd>
                  <dt>Management</dt>
                  <dd className="mono">{ips.interfaces.find((i) => i.name === 'mgmt')?.ip}</dd>
                  <dt>Blind spot</dt>
                  <dd>Traffic that never passes through it, such as server to server on the same switch.</dd>
                </dl>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card eyebrow="Incidents" title="Threat incidents">
        <EmptyState icon={<ShieldOff size={28} aria-hidden="true" />} title="No incidents recorded">
          Incidents correlate the alerts of both sensors into one threat. They will be listed here with severity, source,
          destination, protocol and the reason for detection.
        </EmptyState>
      </Card>
    </div>
  )
}
