import { Send } from 'lucide-react'
import { useMemo, useState } from 'react'

import { session } from '../../playback/session.js'
import { useStore } from '../../state/store.js'
import { Banner, Button, Card, Chip } from '../../ui/index.js'
import {
  DEFAULT_FORM,
  FLAG_PRESETS,
  KINDS,
  MAX_CUSTOM_FLOWS,
  STAFF_TO_DATABASE,
  TCP_FLAGS,
  buildCustomFlow,
  describeCustomFlow,
  firstPacketOfFlow,
  nextFlowId,
  startTimeFor,
  trafficHosts,
  validateForm,
} from './sendTraffic.js'

/**
 * Send traffic: inject one more flow into the run at the playhead. The engine re-simulates the same run
 * with the extra traffic, so everything before the playhead is unchanged and what follows is decided
 * by the real firewall, ACL, IDS and IPS rules, not by this form.
 */
export function SendTrafficPanel() {
  const topology = useStore((s) => s.topology.data)
  const run = useStore((s) => s.run)
  const loaded = useStore((s) => s.playback.loaded)
  const time = useStore((s) => s.playback.time)
  const online = useStore((s) => s.connection.status === 'online')
  const injectTraffic = useStore((s) => s.injectTraffic)
  const clearInjectedTraffic = useStore((s) => s.clearInjectedTraffic)
  const selectPacket = useStore((s) => s.selectPacket)
  const [form, setForm] = useState({ ...DEFAULT_FORM })

  const hosts = useMemo(() => trafficHosts(topology), [topology])
  const injected = run.request?.customFlows ?? []
  const problems = validateForm(form, hosts, injected.length)
  const busy = run.status === 'loading'
  const kind = KINDS.find((k) => k.value === form.kind)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const toggleFlag = (flag) => set({ flags: form.flags.includes(flag) ? form.flags.filter((f) => f !== flag) : [...form.flags, flag] })

  const send = () => {
    const start = startTimeFor(time)
    injectTraffic(buildCustomFlow(form, { id: nextFlowId(injected), start }))
  }
  const events = session.player?.events ?? []

  return (
    <Card eyebrow="Custom traffic" title="Send traffic">
      {!loaded ? (
        <p className="muted">Run a scenario first. Traffic you send is added to that run at the playhead.</p>
      ) : (
        <>
          <div className="send-grid">
            <label className="field">
              <span className="eyebrow">From</span>
              <select value={form.source} onChange={(e) => set({ source: e.target.value })} aria-label="Source host">
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label} · {h.address}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="eyebrow">To</span>
              <select value={form.destination} onChange={(e) => set({ destination: e.target.value })} aria-label="Destination host">
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label} · {h.address}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="eyebrow">Kind</span>
              <select value={form.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Kind of traffic">
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {form.kind !== 'ping' && (
              <label className="field">
                <span className="eyebrow">Port</span>
                <input type="number" min={1} max={65535} value={form.port} onChange={(e) => set({ port: e.target.value })} aria-label="Destination port" />
              </label>
            )}
            {form.kind !== 'tcp' && (
              <label className="field">
                <span className="eyebrow">Count</span>
                <input type="number" min={1} max={10} value={form.count} onChange={(e) => set({ count: e.target.value })} aria-label="How many" />
              </label>
            )}
          </div>
          <p className="muted send-hint">{kind?.hint}</p>

          {form.kind === 'flags' && (
            <div className="send-flags" role="group" aria-label="TCP flags">
              {TCP_FLAGS.map((f) => (
                <button key={f} type="button" className="flag-chip" aria-pressed={form.flags.includes(f)} onClick={() => toggleFlag(f)}>
                  {f}
                </button>
              ))}
              <span className="muted">presets</span>
              {FLAG_PRESETS.map((p) => (
                <button key={p.label} type="button" className="link-btn" onClick={() => set({ flags: [...p.flags] })}>
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {problems.length > 0 && injected.length < MAX_CUSTOM_FLOWS && (
            <p className="send-problems" role="alert">
              {problems[0]}
            </p>
          )}
          {injected.length >= MAX_CUSTOM_FLOWS && <p className="send-problems">{problems.at(-1)}</p>}

          <div className="send-actions">
            <Button variant="primary" icon={<Send size={16} />} disabled={problems.length > 0 || busy || !online} onClick={send}>
              Send at T+{startTimeFor(time).toFixed(1)} s
            </Button>
            <Button size="small" variant="ghost" onClick={() => setForm({ ...STAFF_TO_DATABASE })} title="Staff PC to the database on 3306: the ACL denies it">
              Staff → DB:3306
            </Button>
          </div>

          {run.status === 'error' && (
            <Banner tone="danger" title="The engine refused that traffic">
              {run.error}
            </Banner>
          )}

          {injected.length > 0 && (
            <>
              <h3 className="panel-heading">Injected into this run</h3>
              <ul className="event-list">
                {injected.map((f) => {
                  const pid = firstPacketOfFlow(events, f.id)
                  return (
                    <li key={f.id}>
                      <Chip mono tone="accent">
                        {f.id}
                      </Chip>
                      <span className="mono">T+{f.start.toFixed(1)}</span>
                      <span>{describeCustomFlow(f)}</span>
                      {pid !== null && (
                        <button type="button" className="link-btn mono" onClick={() => selectPacket(pid)}>
                          open packet #{pid}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              <Button size="small" variant="ghost" onClick={clearInjectedTraffic} disabled={busy}>
                Clear injected traffic
              </Button>
            </>
          )}
        </>
      )}
    </Card>
  )
}
