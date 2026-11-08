import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api/client.js'
import { endpointHealth } from '../../playback/securityView.js'
import { useStore } from '../../state/store.js'
import { Banner, Button, Chip, Segmented } from '../../ui/index.js'

const TRUST = [
  { value: 'trusted', label: 'Trusted' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'untrusted', label: 'Untrusted' },
]
const ROLES = [
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
  { value: 'external', label: 'External' },
]
const RESOURCES = [
  { id: 'SIEM-1', proto: 'tcp', port: 443 },
  { id: 'EDR-MGMT-1', proto: 'tcp', port: 8443 },
  { id: 'ZT-POLICY-1', proto: 'tcp', port: 8444 },
  { id: 'SEC-LOG', proto: 'icmp', port: null },
]
const HEALTH_TONE = { healthy: 'ok', suspicious: 'warn', compromised: 'danger', isolated: 'sensor' }

/**
 * The endpoint's Security tab: EDR health with Isolate and Restore, Zero Trust (device trust, role, permissions and an
 * explanation of any decision), and the alerts and SIEM events about this device. Every change goes to the backend, which
 * applies it to its next decisions; the explanation is the backend's, not a text written here.
 * @param {{node: any}} props
 */
export function SecurityTab({ node }) {
  const state = useStore((s) => s.playback.state)
  const server = useStore((s) => s.securityState)
  const setEndpointIsolation = useStore((s) => s.setEndpointIsolation)
  const securityAction = useStore((s) => s.securityAction)
  const [info, setInfo] = useState(null)
  const [explain, setExplain] = useState(null)
  const [resource, setResource] = useState(RESOURCES[0].id)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isolatedOnServer = Boolean(server?.isolated?.includes(node.id))
  const health = endpointHealth(node.id, state, isolatedOnServer)
  const isolated = health === 'isolated'
  const trust = server?.trust?.[node.id] ?? 'trusted'
  const readOnly = Boolean(server?.read_only)

  const load = useCallback(() => {
    api.endpoint(node.id).then(setInfo).catch(() => setInfo(null))
  }, [node.id])
  useEffect(load, [load, server?.digest])
  useEffect(() => setExplain(null), [node.id, server?.digest])

  const act = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  const ask = () => {
    const r = RESOURCES.find((x) => x.id === resource)
    return act(async () => setExplain(await api.explainZeroTrust({ device: node.id, resource: r.id, proto: r.proto, port: r.port })))
  }

  const alerts = (state?.edrAlerts ?? []).filter((a) => a.node === node.id)
  const siem = (state?.siem ?? []).filter((e) => e.node === node.id)
  const history = (info?.edr_history ?? []).filter((e) => e.type === 'edr.alert')

  return (
    <div className="security-tab">
      {readOnly && <Banner tone="info" title="Read-only server">The security state is shared by every visitor here, so it cannot be changed. Run the project locally to isolate or restore endpoints.</Banner>}
      {error && <Banner tone="danger" title="That did not work">{error}</Banner>}

      <h3 className="panel-heading">Endpoint detection and response (EDR)</h3>
      <div className="chip-row">
        <Chip tone={HEALTH_TONE[health]}>{health}</Chip>
        {isolated && <Chip tone="sensor">network traffic blocked</Chip>}
      </div>
      <p className="muted device-description">
        {isolated
          ? `${node.label} is isolated: the backend drops everything it sends and everything sent to it. Other endpoints are not affected.`
          : `${node.label} is not isolated. Isolating it makes the backend drop its traffic from the playhead on; restoring it brings back what the other rules permit.`}
      </p>
      <div className="panel-actions">
        <Button variant="primary" icon={<ShieldAlert size={14} />} disabled={busy || readOnly || isolated} onClick={() => act(() => setEndpointIsolation(node.id, 'isolate'))}>
          Isolate Endpoint
        </Button>
        <Button icon={<ShieldCheck size={14} />} disabled={busy || readOnly || !isolated} onClick={() => act(() => setEndpointIsolation(node.id, 'restore'))}>
          Restore Endpoint
        </Button>
      </div>

      <h3 className="panel-heading">Zero Trust</h3>
      {info?.user ? (
        <p className="muted device-description">
          Signed in as <strong>{info.user.name}</strong> ({info.user.id}), role <strong>{info.user.role}</strong>. Access is decided from identity, role, device trust and an explicit permission.
        </p>
      ) : (
        <p className="muted device-description">No user identity is bound to this device, so Zero Trust grants it nothing.</p>
      )}
      <div className="field-row">
        <div>
          <div className="eyebrow">Device trust</div>
          <Segmented label="Device trust" value={trust} options={TRUST} onChange={(level) => act(() => securityAction({ action: 'trust', node: node.id, level }))} />
        </div>
        {info?.user && (
          <div>
            <div className="eyebrow">User role</div>
            <Segmented label="User role" value={info.user.role} options={ROLES} onChange={(role) => act(() => securityAction({ action: 'role', user: info.user.id, role }))} />
          </div>
        )}
      </div>
      <div className="field-row">
        <label className="field">
          <span className="eyebrow">Explain access to</span>
          <select value={resource} onChange={(e) => setResource(e.target.value)}>
            {RESOURCES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} ({r.proto === 'icmp' ? 'ICMP' : `${r.proto}/${r.port}`})
              </option>
            ))}
          </select>
        </label>
        <Button disabled={busy} onClick={ask}>Explain</Button>
      </div>
      {explain && (
        <div className={`callout callout--${explain.decision === 'allow' ? 'accent' : 'sensor'}`}>
          <strong>
            Zero Trust: {explain.decision} ({explain.request} on {explain.resource})
          </strong>
          <span>{explain.reason}</span>
          <ul className="demo-factors">
            {explain.factors.map((f) => (
              <li key={f} className="mono">{f}</li>
            ))}
          </ul>
          <span className="muted">{explain.note}</span>
        </div>
      )}

      <h3 className="panel-heading">EDR alert history</h3>
      {alerts.length + history.length === 0 ? (
        <p className="muted device-description">No EDR alert for this endpoint.</p>
      ) : (
        <ul className="event-list">
          {[...history.filter((h) => !alerts.some((a) => a.alert_id === h.alert_id)), ...alerts].map((a) => (
            <li key={a.alert_id}>
              <Chip tone={a.severity === 'high' ? 'danger' : 'warn'}>{a.severity}</Chip>
              <span className="mono">{a.alert_id}</span>
              <span>{a.reason}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="panel-heading">SIEM events about this device</h3>
      {siem.length === 0 ? (
        <p className="muted device-description">The SIEM has received no event about {node.label} in the loaded run.</p>
      ) : (
        <ul className="event-list">
          {siem.map((e) => (
            <li key={e.event_id}>
              <Chip tone={e.severity === 'high' ? 'danger' : e.severity === 'medium' ? 'warn' : 'info'}>{e.severity}</Chip>
              <span className="mono">T+{e.t.toFixed(1)}</span>
              <span>
                <strong>{e.source}</strong>: {e.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
