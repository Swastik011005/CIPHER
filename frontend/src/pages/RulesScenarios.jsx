import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client.js'
import { Banner, Button, Card, Chip, Spinner } from '../ui/index.js'
import './pages.css'

const PLANNED = [
  ['S2', 'Port scan with IDS detection'],
  ['S3', 'Unauthorized access'],
  ['S4', 'Excessive traffic'],
  ['S5', 'Same traffic, IPS in Monitor mode'],
  ['S6', 'Same traffic, IPS in Enforce mode'],
  ['S7', 'SSH brute force'],
]

/** Scenarios the engine reports having, loaded live from /api/scenarios. */
function useScenarios() {
  const [state, setState] = useState({ status: 'loading', items: [], error: null })

  const load = useCallback((signal) => {
    setState((s) => ({ ...s, status: 'loading', error: null }))
    api
      .scenarios({ signal })
      .then((items) => setState({ status: 'ready', items, error: null }))
      .catch((error) => {
        if (!signal?.aborted) setState({ status: 'error', items: [], error: error.message })
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  return [state, load]
}

/** Page 5: scenarios the engine can run. Rule editors arrive with the security engine. */
export function RulesScenarios() {
  const [scenarios, reload] = useScenarios()

  return (
    <div className="page">
      <Card eyebrow="Scenarios" title="Available in this build">
        {scenarios.status === 'loading' && (
          <div className="inline-status">
            <Spinner /> <span className="muted">Asking the engine…</span>
          </div>
        )}
        {scenarios.status === 'error' && (
          <Banner tone="danger" title="Cannot load scenarios" action={<Button size="small" onClick={() => reload()}>Retry</Button>}>
            {scenarios.error}
          </Banner>
        )}
        {scenarios.status === 'ready' && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Duration</th>
                  <th>Flows</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.items.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.id}</td>
                    <td>{s.name}</td>
                    <td className="muted cell-wrap">{s.description}</td>
                    <td className="mono">{s.duration} s</td>
                    <td className="mono">{s.flow_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid--2">
        <Card eyebrow="Roadmap" title="Scenarios still to build">
          <ul className="planned">
            {PLANNED.map(([id, name]) => (
              <li key={id}>
                <Chip mono>{id}</Chip>
                <span>{name}</span>
                <Chip tone="warn">Planned</Chip>
              </li>
            ))}
          </ul>
        </Card>

        <Card eyebrow="Policy" title="Rules and thresholds">
          <p className="muted">
            Firewall and ACL rules, detector thresholds and the IPS policy are edited here once the security engine exists.
            Until then there is nothing to configure, so this page offers no controls.
          </p>
        </Card>
      </div>
    </div>
  )
}
