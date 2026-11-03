import { Lock, X } from 'lucide-react'
import { useState } from 'react'

import { useStore } from '../../state/store.js'
import { Button, Card, Chip } from '../../ui/index.js'
import { checkRestrictedAddress, hitsFor } from './rulesLogic.js'

const NODE_NOTE = {
  FW1: 'Firewall between R1-EDGE and the core. Stateful: replies to permitted connections are allowed back in.',
  'CORE-SW1': 'ACL on the core switch, applied to VLAN 10 (Staff) traffic as it enters from the access switch.',
}

function PolicyTable({ policy, restricted, ruleHits }) {
  const shown = (v) => (v === 'restricted' ? `restricted (${restricted.length})` : v)
  return (
    <Card eyebrow={`${policy.node} · ${policy.stateful ? 'stateful' : 'stateless'}`} title={policy.name} as="h3">
      <p className="muted">{NODE_NOTE[policy.node]}</p>
      <div className="table-scroll">
        <table className="table table--compact">
          <thead>
            <tr>
              <th>#</th>
              <th>Action</th>
              <th>Proto</th>
              <th>Source</th>
              <th>Destination</th>
              <th>Port</th>
              <th>Hits in this run</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {policy.rules.map((rule) => (
              <tr key={rule.id} data-disabled={!rule.enabled}>
                <td className="mono">{rule.id}</td>
                <td>
                  <Chip tone={rule.action === 'permit' ? 'ok' : 'danger'}>{rule.action}</Chip>
                </td>
                <td className="mono">{rule.proto}</td>
                <td className="mono">{shown(rule.src)}</td>
                <td className="mono">{shown(rule.dst)}</td>
                <td className="mono">{rule.dport ?? 'any'}</td>
                <td className="mono">{hitsFor(ruleHits, policy.name, rule.id)}</td>
                <td className="muted">{rule.description}</td>
              </tr>
            ))}
            <tr className="row-locked">
              <td className="mono">
                <Lock size={12} aria-hidden="true" />
              </td>
              <td>
                <Chip tone="danger">deny</Chip>
              </td>
              <td className="mono">ip</td>
              <td className="mono">any</td>
              <td className="mono">any</td>
              <td className="mono">any</td>
              <td className="mono">{hitsFor(ruleHits, policy.name, 'implicit-deny')}</td>
              <td className="muted">Implicit deny: {policy.implicit_deny.description.toLowerCase()}. It cannot be removed.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** Restricted source addresses: FW1 denies them first (rule OUTSIDE-IN:10). Each change goes straight to the server. */
function RestrictedAddresses({ restricted, busy, onChange }) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState(null)
  const addresses = restricted.addresses

  const add = async (event) => {
    event.preventDefault()
    const checked = checkRestrictedAddress(text, addresses, restricted.max)
    if (checked.error) return setProblem(checked.error)
    setProblem(checked.warning ?? null)
    if (await onChange([...addresses, checked.address])) setText('')
  }

  return (
    <Card eyebrow="FW1 · OUTSIDE-IN rule 10" title="Restricted source addresses">
      <p className="muted">
        FW1 denies any packet arriving from these outside addresses before it looks at anything else (rule <span className="mono">OUTSIDE-IN:10</span>). No sensor sees what FW1 denies.
      </p>
      <div className="chip-row" aria-label="Restricted addresses">
        {addresses.length === 0 && <span className="muted">No address is restricted.</span>}
        {addresses.map((address) => (
          <span key={address} className="chip chip--mono chip--removable">
            {address}
            <button type="button" aria-label={`Remove ${address}`} disabled={busy} onClick={() => onChange(addresses.filter((a) => a !== address))}>
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <form className="add-address" onSubmit={add} noValidate>
        <label className="field">
          <span className="field__label">Add an address</span>
          <input type="text" value={text} placeholder="203.0.113.66" onChange={(e) => setText(e.target.value)} aria-invalid={Boolean(problem)} aria-label="Address to restrict" />
        </label>
        <Button type="submit" variant="primary" size="small" disabled={busy || text.trim() === ''}>
          Add
        </Button>
        <span className="muted field__hint">
          {addresses.length} of {restricted.max} used · shipped: {restricted.defaults.join(', ') || 'none'}
        </span>
      </form>
      {problem && (
        <p className="field__error" role="alert">
          {problem}
        </p>
      )}
    </Card>
  )
}

export function FirewallTab({ rules, busy, onRestricted }) {
  const ruleHits = useStore((s) => s.playback.state?.ruleHits)
  const loaded = useStore((s) => Boolean(s.playback.state?.meta))
  return (
    <div className="stack">
      <RestrictedAddresses restricted={rules.restricted_ips} busy={busy} onChange={onRestricted} />
      {!loaded && <p className="muted">Hit counts appear here for the run loaded in the 3D simulation.</p>}
      {rules.policies.map((policy) => (
        <PolicyTable key={policy.name} policy={policy} restricted={rules.restricted_ips.addresses} ruleHits={ruleHits} />
      ))}
    </div>
  )
}
