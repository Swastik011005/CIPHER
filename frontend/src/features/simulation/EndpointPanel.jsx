import { useEffect, useState } from 'react'

import { api } from '../../api/client.js'
import { primaryAddress } from '../../scene/deviceInfo.js'
import { DROP_REASON_TEXT, endpointHealth, networkOf, recentConnections } from '../../playback/securityView.js'
import { useStore } from '../../state/store.js'
import { Chip, Segmented } from '../../ui/index.js'
import { CliTerminal } from './CliTerminal.jsx'
import { DevicePanel } from './DevicePanel.jsx'
import { SecurityTab } from './SecurityTab.jsx'

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'cli', label: 'CLI' },
  { value: 'security', label: 'Security' },
]
const HEALTH_TONE = { healthy: 'ok', suspicious: 'warn', compromised: 'danger', isolated: 'sensor' }

/** The endpoint's status block at the top of its Overview tab. */
function EndpointOverview({ node, topology }) {
  const state = useStore((s) => s.playback.state)
  const server = useStore((s) => s.securityState)
  const [info, setInfo] = useState(null)
  useEffect(() => {
    let alive = true
    api.endpoint(node.id).then((d) => alive && setInfo(d)).catch(() => alive && setInfo(null))
    return () => {
      alive = false
    }
  }, [node.id, server?.digest])

  const address = primaryAddress(node)
  const ip = address?.split('/')[0] ?? null
  const iface = node.interfaces.find((i) => i.ip)
  const health = endpointHealth(node.id, state, Boolean(server?.isolated?.includes(node.id)))
  const connections = recentConnections(state, ip)
  const zone = topology.zones.find((z) => z.id === node.zone)
  const rows = [
    ['IP address', ip ?? '—'],
    ['Subnet', iface ? networkOf(iface.ip, iface.prefix) : '—'],
    ['Gateway', iface?.gateway ?? '—'],
    ['VLAN', info?.vlan ? `${info.vlan} (${info.vlan_name})` : 'none (routed network)'],
    ['Role', node.role],
    ['Zone', zone?.name ?? node.zone],
    ['Device trust', info?.trust ?? server?.trust?.[node.id] ?? 'trusted'],
  ]
  return (
    <div className="endpoint-overview">
      <div className="chip-row">
        <Chip tone={HEALTH_TONE[health]}>health: {health}</Chip>
        <Chip tone={health === 'isolated' ? 'sensor' : 'neutral'}>{health === 'isolated' ? 'isolated' : 'not isolated'}</Chip>
        {info?.user && <Chip>{info.user.name} · {info.user.role}</Chip>}
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="panel-heading">Current connections</h3>
      {connections.length === 0 ? (
        <p className="muted device-description">No connection in the loaded run touches {node.label}.</p>
      ) : (
        <ul className="event-list">
          {connections.map((c) => (
            <li key={c.flow}>
              <Chip tone={c.dropped > 0 && c.delivered === 0 ? 'danger' : 'ok'}>{c.dropped > 0 && c.delivered === 0 ? 'failed' : 'ok'}</Chip>
              <span className="mono">
                {c.proto.toUpperCase()} {c.peer}
                {c.port ? `:${c.port}` : ''}
              </span>
              <span className="muted">{c.dropped > 0 ? `${DROP_REASON_TEXT[c.reason] ?? c.reason} at ${c.droppedAt}` : `${c.delivered} delivered`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The panel of a PC, laptop or server: Overview (status and the existing device details), CLI and Security.
 * @param {{node: any, topology: any}} props
 */
export function EndpointPanel({ node, topology }) {
  const [tab, setTab] = useState('overview')
  useEffect(() => setTab('overview'), [node.id])
  const tabs = (
    <>
      <div className="endpoint-tabs">
        <Segmented label="Endpoint panel" value={tab} onChange={setTab} options={TABS} />
      </div>
      {tab === 'overview' && <EndpointOverview node={node} topology={topology} />}
    </>
  )
  return (
    <DevicePanel node={node} topology={topology} tabs={tabs} hideDetails={tab !== 'overview'}>
      {tab === 'cli' ? <CliTerminal node={node} /> : <SecurityTab node={node} />}
    </DevicePanel>
  )
}
