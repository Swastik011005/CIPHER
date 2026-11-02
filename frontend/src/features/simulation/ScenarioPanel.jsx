import { Play } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api/client.js'
import { useStore } from '../../state/store.js'
import { Banner, Button, Card, Chip, Segmented, Spinner } from '../../ui/index.js'

const MODES = [
  { value: 'monitor', label: 'Monitor', title: 'IPS-1 records what it would do but blocks nothing' },
  { value: 'enforce', label: 'Enforce', title: 'IPS-1 applies its prevention actions' },
]

/** Plain-English counters-and-events panel for the run in progress. */
function LiveReadout() {
  const state = useStore((s) => s.playback.state)
  const time = useStore((s) => s.playback.time)
  if (!state) return null
  const blocks = Object.values(state.blocks)
  return (
    <div className="readout">
      {blocks.map((b) => (
        <div key={b.src} className="readout__block">
          <Chip tone="danger">Blocked</Chip>
          <span className="mono">{b.src}</span>
          <span className="muted mono">{Math.max(0, b.until - time).toFixed(1)} s left</span>
        </div>
      ))}
      <ul className="ticker" aria-label="Recent events">
        {state.log.slice(-8).reverse().map((entry) => (
          <li key={entry.seq} data-type={entry.type}>
            <span className="mono ticker__t">{entry.t.toFixed(1)}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Choose a scenario and an IPS mode, run it on the engine and play the returned trace.
 * The scenario list comes from the engine, so only scenarios that exist can be started.
 */
export function ScenarioPanel() {
  const run = useStore((s) => s.run)
  const runScenario = useStore((s) => s.runScenario)
  const connection = useStore((s) => s.connection.status)
  const online = connection === 'online'
  const [scenarios, setScenarios] = useState({ status: 'loading', items: [], error: null })
  const [selected, setSelected] = useState(null)
  const [mode, setMode] = useState('enforce')

  const load = useCallback((signal) => {
    setScenarios((s) => ({ ...s, status: 'loading', error: null }))
    api
      .scenarios({ signal })
      .then((items) => {
        setScenarios({ status: 'ready', items, error: null })
        setSelected((cur) => cur ?? items[0]?.id ?? null)
      })
      .catch((error) => {
        if (!signal?.aborted) setScenarios({ status: 'error', items: [], error: error.message })
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load, online])

  const chosen = scenarios.items.find((s) => s.id === selected)

  return (
    <Card eyebrow="Scenarios" title="Run a scenario">
      {scenarios.status === 'loading' && (
        <div className="inline-status">
          <Spinner /> <span className="muted">Asking the engine…</span>
        </div>
      )}
      {scenarios.status === 'error' && (
        <Banner tone="danger" title="Cannot load scenarios" action={<Button size="small" onClick={() => load()}>Retry</Button>}>
          {scenarios.error}
        </Banner>
      )}

      {scenarios.status === 'ready' && (
        <>
          <div className="scenario-list" role="radiogroup" aria-label="Scenario">
            {scenarios.items.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === selected}
                className="scenario-card"
                onClick={() => setSelected(s.id)}
              >
                <span className="scenario-card__head">
                  <Chip mono>{s.id}</Chip>
                  <strong>{s.name}</strong>
                </span>
                <span className="muted scenario-card__text">{s.description}</span>
              </button>
            ))}
          </div>

          <div className="mode-row">
            <div>
              <div className="eyebrow">IPS mode</div>
              <Segmented label="IPS mode" value={mode} onChange={setMode} options={MODES} />
            </div>
            <Button
              variant="primary"
              icon={run.status === 'loading' ? <Spinner label="Running" /> : <Play size={16} />}
              disabled={!chosen || run.status === 'loading' || !online}
              onClick={() => runScenario(chosen.id, mode)}
            >
              Run
            </Button>
          </div>
          <p className="muted mode-note">
            {mode === 'monitor'
              ? 'Monitor: IDS-1 and IPS-1 both detect and alert. IPS-1 only records what it would block; nothing is dropped.'
              : 'Enforce: IPS-1 blocks the scanning source for a limited time. IDS-1 still only alerts: it is passive.'}
          </p>
        </>
      )}

      {run.status === 'error' && (
        <Banner tone="danger" title="The run failed">
          {run.error}
        </Banner>
      )}
      {run.meta && (
        <div className="chip-row chip-row--top">
          <Chip tone="accent" mono>{run.meta.scenario_id}</Chip>
          <Chip mono>IPS {run.meta.ips_mode}</Chip>
          <Chip mono title="Identical runs give an identical hash">trace {run.meta.trace_hash.slice(0, 8)}</Chip>
        </div>
      )}
      <LiveReadout />
    </Card>
  )
}
