import { Eye, ShieldCheck, ShieldOff } from 'lucide-react'

import { SiemConsole } from '../features/siem/SiemConsole.jsx'
import { useStore } from '../state/store.js'
import { Banner, Card, Chip, EmptyState, KpiTile } from '../ui/index.js'
import './pages.css'

const SEVERITY_TONE = { low: 'info', medium: 'warn', high: 'danger' }

/** Detector names, as the specification defines them. */
const RULE_NAMES = {
  D1: 'Port scan',
  D2: 'Brute force',
  D3: 'Flood',
  D4: 'Restricted service',
  D5: 'Forbidden zone pair',
  D6: 'Invalid TCP flags',
}

/** Why packets were stopped, and by whom. Static policy (FW1, ACL) is not IDS or IPS. */
const DROP_LABELS = {
  fw_deny: ['FW1 deny', 'Firewall policy'],
  acl_deny: ['ACL deny', 'CORE-SW1 ACL'],
  ips_drop: ['IPS drop', 'IPS-1'],
  rate_limited: ['IPS rate limit', 'IPS-1 token bucket (over the limit)'],
  ips_reject: ['IPS reject', 'IPS-1, with a TCP reset'],
  blocked_source: ['Blocked source', 'IPS-1 block table'],
  ttl_expired: ['TTL expired', 'Network'],
  no_route: ['No route', 'Network'],
  edr_isolated: ['EDR isolation', 'EDR agent on the isolated endpoint'],
  zt_deny: ['Zero Trust deny', 'ZT-POLICY-1 decision, enforced at CORE-SW1'],
}

/** Page 4: alerts and prevention actions of the run that is loaded in the simulation. */
export function ThreatCentre() {
  const topology = useStore((s) => s.topology.data)
  const run = useStore((s) => s.run)
  const state = useStore((s) => s.playback.state)
  const time = useStore((s) => s.playback.time)
  const span = topology?.span
  const ids = topology?.nodes.find((n) => n.id === span?.sensor)
  const ips = topology?.nodes.find((n) => n.type === 'ips')

  const alerts = state?.alerts ?? []
  const blocks = Object.values(state?.blocks ?? {})

  return (
    <div className="page">
      {!state ? (
        <Banner tone="info" title="No run loaded">
          Alerts and prevention actions appear here as a scenario plays. Open the 3D simulation, choose a scenario and press Run.
        </Banner>
      ) : (
        <Banner tone="info" title={`Run ${run.meta?.scenario_id} · IPS ${run.meta?.ips_mode} · T+${time.toFixed(1)} s`}>
          Everything below is derived from the same trace as the 3D scene, up to the current playback time.
        </Banner>
      )}

      <div className="grid grid--4">
        <Card><KpiTile label="Incidents" value={state?.counts.incidents ?? 0} hint="threats, both sensors merged" /></Card>
        <Card><KpiTile label="Alerts" value={state?.counts.alerts ?? 0} hint="raw records from IDS-1 and IPS-1" /></Card>
        <Card><KpiTile label="Active blocks" value={blocks.length} hint="sources IPS-1 is blocking now" /></Card>
        <Card><KpiTile label="Packets blocked" value={state?.counts.blocked ?? 0} hint="firewall, ACL and IPS drops" /></Card>
      </div>

      <Card eyebrow="Enforcement" title="Why packets were stopped">
        {Object.keys(state?.drops ?? {}).length === 0 ? (
          <p className="muted">{state ? 'No packet has been stopped yet at this point in the run.' : 'Run a scenario to see enforcement decisions.'}</p>
        ) : (
          <div className="chip-row">
            {Object.entries(state.drops).map(([reason, count]) => (
              <Chip key={reason} tone={reason === 'ttl_expired' || reason === 'no_route' ? 'neutral' : 'danger'} title={DROP_LABELS[reason]?.[1]}>
                {DROP_LABELS[reason]?.[0] ?? reason} · {count}
              </Chip>
            ))}
          </div>
        )}
        <p className="muted">IDS-1 never appears here: it only raises alerts. Packets are stopped by FW1, the CORE-SW1 ACL and IPS-1.</p>
      </Card>

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

      <Card eyebrow="Alerts" title="Detections so far">
        {alerts.length === 0 ? (
          <EmptyState icon={<ShieldOff size={28} aria-hidden="true" />} title="No alerts yet">
            {state ? 'Nothing has been detected up to this point in the run.' : 'Run a scenario to see detections.'}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Sensor</th>
                  <th>Severity</th>
                  <th>Rule</th>
                  <th>Source</th>
                  <th>Target</th>
                  <th>Evidence</th>
                  <th>Incident</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.alert_id}>
                    <td className="mono">T+{a.t.toFixed(2)}</td>
                    <td>
                      <Chip tone={a.sensor === 'IDS-1' ? 'sensor' : 'accent'}>{a.sensor}</Chip>
                    </td>
                    <td>
                      <Chip tone={SEVERITY_TONE[a.severity]}>{a.severity.toUpperCase()}</Chip>
                    </td>
                    <td>
                      <span className="mono">{a.rule}</span> <span className="muted">{RULE_NAMES[a.rule] ?? ''}</span>
                    </td>
                    <td className="mono">{a.src}</td>
                    <td className="mono">{a.dst}</td>
                    <td className="muted cell-wrap">{a.reason}</td>
                    <td className="mono">{a.incident_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {blocks.length > 0 && (
          <div className="chip-row chip-row--top">
            {blocks.map((b) => (
              <Chip key={b.src} tone="danger" mono>
                IPS-1 blocking {b.src} · {Math.max(0, b.until - time).toFixed(1)} s left
              </Chip>
            ))}
          </div>
        )}
      </Card>
      <SiemConsole />
    </div>
  )
}
