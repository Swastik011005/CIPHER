import { X } from 'lucide-react'
import { useMemo } from 'react'

import { packetInspector, recentPackets } from '../../playback/inspectors.js'
import { useStore } from '../../state/store.js'
import { Button, Card, Chip, StatusDot } from '../../ui/index.js'

const VERDICT_TONE = { allowed: 'ok', flagged: 'warn', blocked: 'danger' }
const VERDICT_TEXT = { allowed: 'Allowed', flagged: 'Flagged suspicious', blocked: 'Blocked' }

/**
 * Details of the selected packet: its 5-tuple, flags, every hop with TTL and VLAN, and each
 * security decision made about it. All of it is read from the engine's trace at the playhead.
 * @param {{pid: number}} props
 */
export function PacketPanel({ pid }) {
  const state = useStore((s) => s.playback.state)
  const time = useStore((s) => s.playback.time)
  const selectPacket = useStore((s) => s.selectPacket)
  const info = useMemo(() => (state ? packetInspector(state, pid, time) : null), [state, pid, time])

  return (
    <Card
      eyebrow={info?.isCopy ? 'SPAN mirror copy' : 'Selected packet'}
      title={`Packet #${pid}`}
      actions={<Button size="small" variant="ghost" icon={<X size={14} />} onClick={() => selectPacket(null)} aria-label="Clear packet selection" title="Clear selection (Esc)" />}
    >
      {!info ? (
        <p className="muted">This packet has not been created yet at the playhead. Move the timeline forward to see it.</p>
      ) : (
        <>
          <div className="chip-row">
            <Chip tone="accent">{info.proto.toUpperCase()}</Chip>
            {info.flags.map((f) => (
              <Chip key={f} mono>
                {f}
              </Chip>
            ))}
            <Chip>
              <StatusDot tone={info.status.tone} /> {info.status.text}
            </Chip>
            {info.verdict && <Chip tone={VERDICT_TONE[info.verdict.kind]}>{VERDICT_TEXT[info.verdict.kind]}</Chip>}
          </div>

          <p className="packet-tuple mono">
            {info.src}
            {info.sport != null ? `:${info.sport}` : ''} → {info.dst}
            {info.dport != null ? `:${info.dport}` : ''}
          </p>
          <dl className="stat-grid">
            <div className="stat-grid__item">
              <dt>Flow</dt>
              <dd className="mono">{info.flow}</dd>
            </div>
            <div className="stat-grid__item">
              <dt>TTL at source</dt>
              <dd className="mono">{info.ttlAtSource}</dd>
            </div>
            <div className="stat-grid__item">
              <dt>Length</dt>
              <dd className="mono">{info.length} B</dd>
            </div>
            <div className="stat-grid__item">
              <dt>Created</dt>
              <dd className="mono">T+{info.createdAt.toFixed(2)}</dd>
            </div>
          </dl>

          {info.injectedBy && (
            <div className="callout callout--accent">
              <strong>Injected by {info.injectedBy}</strong>
              <span>
                This reset was not sent by {info.src}. IPS-1 made it up, spoofed as that server, to end a connection it rejected.
                It is synthetic: nothing is sent on a real network.
              </span>
            </div>
          )}
          {info.isCopy ? (
            <div className="callout callout--sensor">
              <strong>Copy of packet #{info.copyOf}</strong>
              <span>IDS-1 only ever receives copies like this one. The original keeps moving; nothing IDS-1 concludes can change it.</span>
              <Button size="small" onClick={() => selectPacket(info.copyOf)}>
                Show original
              </Button>
            </div>
          ) : (
            info.copies.length > 0 && (
              <p className="muted">
                SPAN copy sent to IDS-1:{' '}
                {info.copies.map((c) => (
                  <button key={c} type="button" className="link-btn mono" onClick={() => selectPacket(c)}>
                    #{c}
                  </button>
                ))}
              </p>
            )
          )}

          <h3 className="panel-heading">Hops ({info.hops.length})</h3>
          {info.hops.length === 0 ? (
            <p className="muted">No hop yet.</p>
          ) : (
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>From → to</th>
                  <th>Link</th>
                  <th>VLAN</th>
                  <th>TTL</th>
                  <th>T+</th>
                </tr>
              </thead>
              <tbody>
                {info.hops.map((h) => (
                  <tr key={h.n}>
                    <td className="mono">{h.n}</td>
                    <td className="mono">
                      {h.from} → {h.to}
                    </td>
                    <td className="mono">{h.link}</td>
                    <td className="mono">{h.vlan ?? '—'}</td>
                    <td className="mono">{h.ttl}</td>
                    <td className="mono">{h.t.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="panel-heading">Security decisions</h3>
          {info.trail.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="event-list">
              {info.trail.map((d) => (
                <li key={d.seq}>
                  <Chip tone={d.tone}>{d.node}</Chip>
                  <span className="mono">T+{d.t.toFixed(2)}</span>
                  <span>{d.text}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}

/** The most recent packets of the run: the keyboard- and touch-friendly way to open the packet inspector. */
export function PacketList() {
  const state = useStore((s) => s.playback.state)
  const time = useStore((s) => s.playback.time)
  const selectPacket = useStore((s) => s.selectPacket)
  const rows = useMemo(() => (state?.meta ? recentPackets(state, time) : []), [state, time])
  if (rows.length === 0) return null

  return (
    <Card eyebrow="Run" title="Recent packets">
      <ul className="packet-list">
        {rows.map((r) => (
          <li key={r.pid}>
            <button type="button" className="packet-row" onClick={() => selectPacket(r.pid)}>
              <StatusDot tone={r.verdict ? VERDICT_TONE[r.verdict] : 'neutral'} />
              <span className="mono packet-row__id">#{r.pid}</span>
              <span className="mono packet-row__what">
                {r.proto.toUpperCase()} {r.flags.join('+')} {r.label}
              </span>
              <span className="packet-row__status">{r.status.text}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">Click a packet in the scene, or here, to inspect its hops and the decisions made about it.</p>
    </Card>
  )
}
