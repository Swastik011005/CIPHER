import { useNavigate } from 'react-router-dom'

import { labelAddress, linkVlanLabel } from '../scene/deviceInfo.js'
import { useStore } from '../state/store.js'
import { Banner, Card, Chip, Spinner } from '../ui/index.js'
import './pages.css'

/** Page 3: inventory of the simulated network. Live traffic metrics need a running simulation. */
export function NetworkMonitoring() {
  const topology = useStore((s) => s.topology)
  const select = useStore((s) => s.select)
  const requestFocus = useStore((s) => s.requestFocus)
  const navigate = useNavigate()
  const data = topology.data

  const openInScene = (id) => {
    select(id)
    requestFocus(id)
    navigate('/simulation')
  }

  return (
    <div className="page">
      <Banner tone="info" title="No traffic to monitor yet">
        Throughput, drops and per-link utilisation appear here once scenarios play in the simulation. Until then this page
        lists the devices and links that will be measured, straight from the engine&apos;s topology.
      </Banner>

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
