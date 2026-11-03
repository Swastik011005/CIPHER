import { Box, Eye, Shield, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useStore } from '../state/store.js'
import { Banner, Card, Chip, KpiTile, Spinner } from '../ui/index.js'
import './pages.css'

const LAYERS = [
  {
    icon: Shield,
    name: 'Firewall',
    where: 'FW1 and the CORE-SW1 ACL',
    text: 'Permits or denies traffic by address and port. It cannot see behaviour such as a port scan on an allowed service.',
    stage: 'Implemented: FW1 and the STAFF-IN ACL',
  },
  {
    icon: Eye,
    name: 'IDS',
    where: 'IDS-1, passive',
    text: 'Watches copies of traffic sent to it over a SPAN port and raises alerts. It cannot block anything, because it is not in the path.',
    stage: 'Implemented: D1 port scan, D4 restricted service, D5 forbidden zone pair, D6 invalid TCP flags',
  },
  {
    icon: ShieldCheck,
    name: 'IPS',
    where: 'IPS-1, inline',
    text: 'Sits in the path to the servers, so it can drop, reject or block traffic once a rule says so.',
    stage: 'Implemented: Monitor and Enforce (drop, reject with a TCP reset, block source)',
  },
]

/** Page 1: what this project is, and the real shape of the network it simulates. */
export function OverviewDashboard() {
  const topology = useStore((s) => s.topology)
  const connection = useStore((s) => s.connection)
  const data = topology.data

  return (
    <div className="page">
      <Card className="hero">
        <div className="eyebrow eyebrow--accent">Intelligent network security</div>
        <h2 className="hero__title">See how traffic is inspected, detected and stopped.</h2>
        <p className="muted hero__text">
          A simulated enterprise campus with a firewall, a passive intrusion detection system and an inline intrusion
          prevention system. Explore it in 3D and see which device is responsible for what. All traffic is synthetic.
        </p>
        <div className="hero__actions">
          <Link className="btn btn--primary" to="/simulation">
            <Box size={16} aria-hidden="true" /> Open the 3D simulation
          </Link>
          <Link className="btn" to="/monitoring">
            View network inventory
          </Link>
        </div>
      </Card>

      {topology.status === 'error' && !data && (
        <Banner tone="danger" title="Cannot load the topology">
          {topology.error}. Start the backend with <code>python app.py</code>.
        </Banner>
      )}

      <div className="grid grid--4">
        {data ? (
          <>
            <Card><KpiTile label="Devices" value={data.summary.devices} hint="plus the Internet segment" /></Card>
            <Card><KpiTile label="Links" value={data.summary.links} hint="cables in the 3D scene" /></Card>
            <Card><KpiTile label="VLANs" value={data.summary.vlans} hint={data.vlans.map((v) => `${v.id} ${v.name}`).join(' · ')} /></Card>
            <Card><KpiTile label="IP subnets" value={data.summary.subnets} hint="4 VLAN + 3 routed" /></Card>
          </>
        ) : (
          <Card className="grid__span">
            <div className="inline-status">
              <Spinner /> <span className="muted">Waiting for the topology from the engine…</span>
            </div>
          </Card>
        )}
      </div>

      <Card eyebrow="Defence in depth" title="Three layers, three different jobs">
        <div className="grid grid--3">
          {LAYERS.map(({ icon: Icon, name, where, text, stage }) => (
            <div key={name} className="layer">
              <div className="layer__head">
                <Icon size={20} aria-hidden="true" />
                <div>
                  <h3>{name}</h3>
                  <div className="muted layer__where">{where}</div>
                </div>
              </div>
              <p className="muted">{text}</p>
              <Chip tone="ok">{stage}</Chip>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid--2">
        <Card eyebrow="Network" title="Zones and addressing">
          {data ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>VLAN</th>
                  <th>Subnet</th>
                  <th>Devices</th>
                </tr>
              </thead>
              <tbody>
                {data.zones.map((zone) => {
                  const subnet = zone.vlan ? data.subnets.find((s) => s.vlan === zone.vlan) : null
                  return (
                    <tr key={zone.id}>
                      <td>{zone.name}</td>
                      <td className="mono">{zone.vlan ?? '—'}</td>
                      <td className="mono">{subnet?.cidr ?? '—'}</td>
                      <td className="mono">{data.nodes.filter((n) => n.zone === zone.id).length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted">Available once the topology has loaded.</p>
          )}
        </Card>

        <Card eyebrow="Engine" title="Backend status">
          {connection.status === 'online' ? (
            <dl className="kv">
              <dt>Service</dt>
              <dd className="mono">{connection.health.service}</dd>
              <dt>Version</dt>
              <dd className="mono">{connection.health.version}</dd>
              <dt>Stage</dt>
              <dd className="mono">{connection.health.stage}</dd>
              <dt>Uptime</dt>
              <dd className="mono">{connection.health.uptime_s} s</dd>
              <dt>Mode</dt>
              <dd>
                {connection.health.mode}
                {connection.health.real_traffic === false && ' · no real traffic'}
              </dd>
              <dt>Scenarios</dt>
              <dd className="mono">{connection.health.scenarios_available.join(', ') || 'none'}</dd>
            </dl>
          ) : (
            <Banner tone={connection.status === 'offline' ? 'danger' : 'info'} title={connection.status === 'offline' ? 'Engine offline' : 'Connecting'}>
              {connection.status === 'offline' ? `${connection.error}. Retrying every 3 s.` : 'Waiting for the first health check.'}
            </Banner>
          )}
        </Card>
      </div>
    </div>
  )
}
