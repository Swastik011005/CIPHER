import { CheckCircle2, Play, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../../api/client.js'
import { useStore } from '../../state/store.js'
import { Banner, Button, Card, Chip, Segmented, Spinner } from '../../ui/index.js'
import { orderChecks, summariseChecks } from './rulesLogic.js'

const MODES = [
  { value: 'monitor', label: 'Monitor' },
  { value: 'enforce', label: 'Enforce' },
]

function ResultRun({ run }) {
  return (
    <details className="result-run" open={!run.passed} data-passed={run.passed}>
      <summary>
        {run.passed ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
        <span className="mono">{run.scenario_id}</span>
        <span>{run.name}</span>
        <Chip>{run.ips_mode}</Chip>
        <Chip tone={run.passed ? 'ok' : 'danger'}>{run.passed ? 'PASS' : 'FAIL'}</Chip>
        <span className="muted">
          {run.checks.filter((c) => c.passed).length} of {run.checks.length} checks
        </span>
      </summary>
      <div className="table-scroll">
        <table className="table table--compact">
          <thead>
            <tr>
              <th>Check</th>
              <th>Expected</th>
              <th>Actual</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orderChecks(run.checks).map((check) => (
              <tr key={check.id} data-passed={check.passed}>
                <td>{check.description}</td>
                <td className="mono">{check.expected}</td>
                <td className="mono">{check.actual}</td>
                <td>
                  <Chip tone={check.passed ? 'ok' : 'danger'}>{check.passed ? 'PASS' : 'FAIL'}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mono">trace {run.trace_hash.slice(0, 12)}</p>
    </details>
  )
}

/**
 * The scenario library (what each scenario is, what it should do, how to launch it) and the validation
 * workflow: the engine runs the scenarios with the rules in force and checks each expected behaviour.
 * @param {{rules: any, customised: boolean}} props
 */
export function ScenariosTab({ customised }) {
  const navigate = useNavigate()
  const runScenario = useStore((s) => s.runScenario)
  const online = useStore((s) => s.connection.status === 'online')
  const [library, setLibrary] = useState({ status: 'loading', items: [], error: null })
  const [modes, setModes] = useState({})
  const [validation, setValidation] = useState({ status: 'idle', data: null, error: null, scope: null })

  useEffect(() => {
    const controller = new AbortController()
    api
      .scenarios({ signal: controller.signal })
      .then((items) => setLibrary({ status: 'ready', items, error: null }))
      .catch((error) => !controller.signal.aborted && setLibrary({ status: 'error', items: [], error: error.message }))
    return () => controller.abort()
  }, [])

  const check = useCallback(async (scenarioIds) => {
    setValidation({ status: 'running', data: null, error: null, scope: scenarioIds ? scenarioIds[0] : 'all' })
    try {
      const data = await api.validate(scenarioIds ? { scenario_ids: scenarioIds } : {})
      setValidation({ status: 'done', data, error: null, scope: scenarioIds ? scenarioIds[0] : 'all' })
    } catch (error) {
      setValidation({ status: 'error', data: null, error: error.message, scope: null })
    }
  }, [])

  const play = async (scenario) => {
    const mode = scenario.pinned_ips_mode ?? modes[scenario.id] ?? 'enforce'
    navigate('/simulation')
    await runScenario(scenario.id, mode)
  }

  const summary = validation.data?.summary
  return (
    <div className="stack">
      <Card
        eyebrow="Validation"
        title="Check the scenarios"
        actions={
          <Button variant="primary" icon={validation.status === 'running' && validation.scope === 'all' ? <Spinner label="Running" /> : <Play size={16} />} disabled={!online || validation.status === 'running'} onClick={() => check(null)}>
            Run all checks
          </Button>
        }
      >
        <p className="muted">
          The engine runs every scenario in each IPS mode it supports, with the rules in force, and checks what it is expected to do (listed on each card below). With the shipped rules every check passes;
          after an edit, a failing check shows exactly what the edit changed.
        </p>
        {validation.status === 'running' && (
          <div className="inline-status">
            <Spinner /> <span className="muted">Running the scenarios on the engine…</span>
          </div>
        )}
        {validation.status === 'error' && (
          <Banner tone="danger" title="The checks could not run">
            {validation.error}
          </Banner>
        )}
        {validation.status === 'done' && (
          <>
            <div className="validation-summary" data-passed={summary.runs_passed === summary.runs}>
              <Chip tone={summary.runs_passed === summary.runs ? 'ok' : 'danger'}>{summary.runs_passed === summary.runs ? 'ALL PASS' : 'SOME FAIL'}</Chip>
              <strong>{summariseChecks(summary)}</strong>
              <span className="muted">
                {validation.data.rules_customised ? 'checked with custom rules' : 'checked with the shipped rules'} · rules {validation.data.rules_hash}
              </span>
            </div>
            <div className="results">
              {validation.data.results.map((run) => (
                <ResultRun key={`${run.scenario_id}-${run.ips_mode}`} run={run} />
              ))}
            </div>
          </>
        )}
        {customised && validation.status !== 'done' && <p className="muted">Custom rules are in force, so some checks may fail on purpose.</p>}
      </Card>

      <h2 className="visually-hidden">Scenario library</h2>
      {library.status === 'loading' && (
        <div className="inline-status">
          <Spinner /> <span className="muted">Asking the engine…</span>
        </div>
      )}
      {library.status === 'error' && (
        <Banner tone="danger" title="Cannot load the scenarios">
          {library.error}
        </Banner>
      )}
      <div className="scenario-library">
        {library.items.map((s) => {
          const mode = s.pinned_ips_mode ?? modes[s.id] ?? 'enforce'
          const expected = s.expected[mode] ?? []
          return (
            <section key={s.id} className="card scenario-lib" aria-label={`${s.id} ${s.name}`}>
              <header>
                <div className="eyebrow">
                  {s.id} · {s.duration} s · {s.flow_count} flows
                </div>
                <h3>{s.name}</h3>
              </header>
              <p className="muted">{s.description}</p>
              <div className="scenario-lib__mode">
                {s.pinned_ips_mode ? (
                  <Chip tone={s.pinned_ips_mode === 'enforce' ? 'accent' : 'warn'}>Pinned to {s.pinned_ips_mode === 'enforce' ? 'Enforce' : 'Monitor'}</Chip>
                ) : (
                  <Segmented label={`${s.id} IPS mode`} value={mode} onChange={(v) => setModes((m) => ({ ...m, [s.id]: v }))} options={MODES} />
                )}
              </div>
              <h4 className="panel-heading">Expected in {mode === 'enforce' ? 'Enforce' : 'Monitor'} mode</h4>
              <ul className="expected">
                {expected.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className="scenario-lib__actions">
                <Button variant="primary" size="small" icon={<Play size={14} />} disabled={!online} onClick={() => play(s)}>
                  Play in 3D
                </Button>
                <Button size="small" disabled={!online || validation.status === 'running'} onClick={() => check([s.id])}>
                  {validation.status === 'running' && validation.scope === s.id ? 'Checking…' : 'Run check'}
                </Button>
                {validation.status === 'done' && validation.scope === s.id && (
                  <Chip tone={validation.data.results.every((r) => r.passed) ? 'ok' : 'danger'}>{validation.data.results.every((r) => r.passed) ? 'PASS' : 'FAIL'}</Chip>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
