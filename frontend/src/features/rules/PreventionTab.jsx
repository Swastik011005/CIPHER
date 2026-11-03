import { Card, Chip } from '../../ui/index.js'
import { describeIpsRule } from './rulesLogic.js'

const ORDER = [
  ['1', 'Block table', 'A source that is blocked is dropped at once; detectors are not consulted for it.'],
  ['2', 'Detectors', 'Every other packet is shown to the detectors first, so a rate limiter can never hide a flood from them.'],
  ['3', 'Policy lookup', 'The most severe finding is looked up in the table below.'],
  ['4', 'Enforce or record', 'Enforce mode applies the action. Monitor mode records what it would have done and forwards the packet.'],
  ['5', 'Forward', 'Anything not dropped goes on to the server.'],
]

const SEVERITY_TONE = { low: 'info', medium: 'warn', high: 'danger' }

/** IPS-1's policy, as it is in force. It is shown, not edited: the actions are part of the design. */
export function PreventionTab({ rules, detectors }) {
  const policy = rules.ips_policy
  return (
    <div className="stack">
      <Card eyebrow="IPS-1 · inline" title="What IPS-1 does with each packet">
        <ol className="order">
          {ORDER.map(([n, title, text]) => (
            <li key={n}>
              <span className="order__n">{n}</span>
              <div>
                <strong>{title}</strong>
                <div className="muted">{text}</div>
              </div>
            </li>
          ))}
        </ol>
        <p className="muted">
          IDS-1 has no such table. It only raises alerts, and nothing it concludes can drop, reject, limit or block a packet.
        </p>
      </Card>

      <Card eyebrow="Policy" title="Detector → action (Enforce mode)">
        <div className="table-scroll">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Detector</th>
                <th>When it finds</th>
                <th>IPS-1 will</th>
                <th>In Monitor mode</th>
              </tr>
            </thead>
            <tbody>
              {policy.rules.map((rule) => (
                <tr key={`${rule.detector}-${rule.severity}`}>
                  <td>
                    <span className="mono">{rule.detector}</span> <span className="muted">{detectors[rule.detector]?.name}</span>
                  </td>
                  <td>
                    <Chip tone={SEVERITY_TONE[rule.severity]}>{rule.severity.toUpperCase()}</Chip>
                  </td>
                  <td>{describeIpsRule(rule)}</td>
                  <td className="muted">{rule.action === 'allow' ? 'the same' : 'records it, applies nothing'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card eyebrow="Never acted on" title="Infrastructure allowlist">
        <p className="muted">Sources in these networks are still detected and alerted on, but IPS-1 never limits, rejects, drops or blocks them.</p>
        <div className="chip-row">
          {policy.allowlist.map((cidr) => (
            <Chip key={cidr} mono>
              {cidr}
            </Chip>
          ))}
        </div>
        <p className="muted">{policy.note}</p>
      </Card>
    </div>
  )
}
