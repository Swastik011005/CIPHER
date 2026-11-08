import { Play, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { describeOutcome } from '../../playback/securityView.js'
import { useStore } from '../../state/store.js'
import { Banner, Button, Card, Chip, Segmented, Spinner } from '../../ui/index.js'

const MODES = [
  { value: 'monitor', label: 'Monitor', title: 'IPS-1 records what it would do but blocks nothing' },
  { value: 'enforce', label: 'Enforce', title: 'IPS-1 applies its prevention actions' },
]
const TONE = { ok: 'ok', danger: 'danger', warn: 'warn', info: 'info' }
const NONE = Object.freeze([]) // a stable empty list: a selector must not build a new array on every call

/** What the run shows so far, in plain sentences from the trace, and the events the SIEM received. */
function Outcome({ scenario }) {
  const state = useStore((s) => s.playback.state)
  const finished = useStore((s) => s.playback.finished)
  const meta = useStore((s) => s.run.meta)
  const forThis = meta?.scenario_id === scenario.id
  if (!forThis || !state) return null
  const lines = describeOutcome(state)
  return (
    <div className="demo-outcome" aria-live="polite">
      <h3 className="panel-heading">{finished ? 'Final outcome' : 'Outcome so far'}</h3>
      <ul className="demo-outcome__list">
        {lines.map((l) => (
          <li key={l.text}>
            <Chip tone={TONE[l.tone]}>{l.tone === 'ok' ? 'OK' : l.tone === 'danger' ? 'STOPPED' : l.tone === 'warn' ? 'ALERT' : 'INFO'}</Chip>
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
      {state.siem.length > 0 && (
        <>
          <h3 className="panel-heading">SIEM events for this run</h3>
          <ul className="event-list">
            {state.siem.slice(-6).map((e) => (
              <li key={e.event_id}>
                <Chip tone={e.severity === 'high' ? 'danger' : e.severity === 'medium' ? 'warn' : 'info'}>{e.severity}</Chip>
                <span className="mono">T+{e.t.toFixed(1)}</span>
                <span>
                  <strong>{e.source}</strong> · {e.node}: {e.reason}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * The nine presentation scenarios, with objective, path, rule, Run and Reset. The engine produces every result: this panel only
 * starts a run and shows what its trace says. Reset restores the server's security state (isolation, trust, roles) and reloads
 * the scenario paused at T+0, so every scenario can be repeated from the same starting point.
 */
export function DemoScenarios() {
  const presentation = useStore((s) => s.presentation)
  const run = useStore((s) => s.run)
  const runScenario = useStore((s) => s.runScenario)
  const resetSecurity = useStore((s) => s.resetSecurity)
  const online = useStore((s) => s.connection.status) === 'online'
  const isolated = useStore((s) => s.securityState?.isolated ?? NONE)
  const [selected, setSelected] = useState('P1')
  const [mode, setMode] = useState('enforce')
  const [scripted, setScripted] = useState(false)
  const [error, setError] = useState(null)
  const items = presentation.items
  const chosen = items.find((s) => s.id === selected) ?? items[0]

  useEffect(() => {
    if (items.length && !items.some((s) => s.id === selected)) setSelected(items[0].id)
  }, [items, selected])

  if (presentation.status === 'idle' || (presentation.status === 'loading' && items.length === 0)) {
    return (
      <Card eyebrow="Demonstration" title="The nine scenarios">
        <div className="inline-status"><Spinner /> <span className="muted">Asking the engine…</span></div>
      </Card>
    )
  }
  if (items.length === 0) {
    return (
      <Card eyebrow="Demonstration" title="The nine scenarios">
        <Banner tone="danger" title="Cannot load the scenarios">{presentation.error}</Banner>
      </Card>
    )
  }

  const hasOperator = (chosen?.operator_actions?.length ?? 0) > 0
  const start = async () => {
    setError(null)
    try {
      await runScenario(chosen.id, mode, [], null, [], { scriptedOperator: scripted && hasOperator })
    } catch (e) {
      setError(e?.message ?? String(e))
    }
  }
  const reset = async () => {
    setError(null)
    try {
      await resetSecurity()
      await runScenario(chosen.id, mode, [], { time: 0, playing: false })
    } catch (e) {
      setError(e?.message ?? String(e))
    }
  }

  return (
    <Card eyebrow="Demonstration" title="The nine scenarios">
      <div className="scenario-list" role="radiogroup" aria-label="Demonstration scenario">
        {items.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={s.id === selected} className="scenario-card" onClick={() => setSelected(s.id)}>
            <span className="scenario-card__head">
              <Chip mono>{s.number}</Chip>
              <strong>{s.name}</strong>
            </span>
          </button>
        ))}
      </div>

      {chosen && (
        <div className="demo-detail">
          <p className="device-role">{chosen.objective}</p>
          <dl className="stat-grid">
            <div className="stat-grid__item"><dt>Source</dt><dd className="mono">{chosen.source}</dd></div>
            <div className="stat-grid__item"><dt>Destination</dt><dd className="mono">{chosen.destination}</dd></div>
            <div className="stat-grid__item"><dt>Protocol</dt><dd className="mono">{chosen.protocol}{chosen.port ? `/${chosen.port}` : ''}</dd></div>
            <div className="stat-grid__item"><dt>Duration</dt><dd className="mono">{chosen.duration} s</dd></div>
          </dl>
          <p className="muted demo-rule"><strong>Rule:</strong> {chosen.security_rule}</p>

          <div className="mode-row">
            <div>
              <div className="eyebrow">IPS mode</div>
              <Segmented label="IPS mode" value={mode} onChange={setMode} options={MODES} />
            </div>
            <div className="panel-actions">
              <Button variant="primary" icon={run.status === 'loading' ? <Spinner label="Running" /> : <Play size={16} />} disabled={!online || run.status === 'loading'} onClick={start}>
                Run
              </Button>
              <Button icon={<RotateCcw size={14} />} disabled={!online || run.status === 'loading'} onClick={reset} title="Reset the security state (isolation, trust, roles) and reload this scenario at T+0">
                Reset
              </Button>
            </div>
          </div>
          {hasOperator && (
            <label className="demo-check">
              <input type="checkbox" checked={scripted} onChange={(e) => setScripted(e.target.checked)} />
              <span>Run the scripted operator action (automatic demo). Leave it off to act yourself: select {chosen.operator_actions[0].node}, open its Security tab and use {chosen.operator_actions[0].action === 'isolate' ? 'Isolate Endpoint' : 'Restore Endpoint'}.</span>
            </label>
          )}
          {isolated.length > 0 && (
            <Banner tone="info" title={`Isolated on the server: ${isolated.join(', ')}`}>
              A committed isolation applies to every later run and CLI command until you restore the endpoint or press Reset.
            </Banner>
          )}
          {error && <Banner tone="danger" title="The run failed">{error}</Banner>}

          <p className="muted demo-explanation">{chosen.explanation}</p>
          <details className="demo-expected">
            <summary>What this scenario should show</summary>
            <ul>
              {chosen.expected.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </details>
          <Outcome scenario={chosen} />
        </div>
      )}
      <p className="muted mode-note">All traffic, detection, endpoint telemetry and responses here are synthetic and decided by the deterministic backend. Nothing is a real network, IDS, IPS, SIEM or EDR.</p>
    </Card>
  )
}
