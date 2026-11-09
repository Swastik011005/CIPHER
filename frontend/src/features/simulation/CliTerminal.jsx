import { useEffect, useRef, useState } from 'react'

import { useStore } from '../../state/store.js'
import { isRunning, visibleLines } from './cliTimeline.js'

const DEVICE_SUGGESTIONS = ['help', 'show ip interface brief', 'show access-lists', 'show ip route', 'show interfaces', 'show running-config']
const SUGGESTIONS = ['help', 'ipconfig', 'ping APP-SRV', 'ping SIEM-1', 'tracert APP-SRV', 'telnet DB-SRV 3306', 'curl http://APP-SRV']

/**
 * A simulated Windows-style terminal for one endpoint. A command is sent to the backend, which checks it against a whitelist and
 * runs it through the same engine, rules, Zero Trust policy and EDR state as the nine scenarios; the printed lines are written
 * from that run's trace. Nothing is executed on this computer. The packets of a network command can replay in the 3D campus.
 * @param {{node: any}} props
 */
export function CliTerminal({ node }) {
  const history = useStore((s) => s.cli[node.id]) ?? []
  const runCli = useStore((s) => s.runCli)
  const cancelCli = useStore((s) => s.cancelCli)
  const liveRun = useStore((s) => s.cliLive)
  const time = useStore((s) => s.playback.time)
  const finished = useStore((s) => s.playback.finished)
  const live = { token: liveRun?.node === node.id ? liveRun.token : null, time, finished }
  const running = history.some((h) => isRunning(h, live))
  const online = useStore((s) => s.connection.status) === 'online'
  const [value, setValue] = useState('')
  const [animate, setAnimate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [back, setBack] = useState(-1)
  const screen = useRef(null)
  const device = node.type !== 'host' // the router, the core switch and the firewall have a read-only `show` command line
  const prompt = device ? `${node.id}#` : `C:\\${node.id}>`

  useEffect(() => {
    if (screen.current) screen.current.scrollTop = screen.current.scrollHeight
  }, [history.length, busy, time])

  const send = async (text) => {
    if (!text.trim() || busy || running) return
    setBusy(true)
    setBack(-1)
    setValue('')
    await runCli(node.id, text, animate)
    setBusy(false)
  }

  const onKeyDown = (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && running) {
      event.preventDefault()
      cancelCli()
      return
    }
    const inputs = history.map((h) => h.input)
    if (event.key === 'ArrowUp' && inputs.length) {
      event.preventDefault()
      const next = Math.min(back + 1, inputs.length - 1)
      setBack(next)
      setValue(inputs[inputs.length - 1 - next])
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = Math.max(back - 1, -1)
      setBack(next)
      setValue(next === -1 ? '' : inputs[inputs.length - 1 - next])
    }
  }

  return (
    <div className="cli" data-testid="cli">
      <div className="cli__screen" ref={screen} role="log" aria-live="polite" aria-label={`${node.label} command line output`}>
        <div className="cli__banner">{device ? `Read-only simulated device command line: ${node.label}. Type "help". Nothing can be changed.` : `Simulated endpoint command line: ${node.label}. Type "help". Synthetic traffic only; nothing runs on this computer.`}</div>
        {history.map((h, i) => (
          <div key={i} className="cli__entry">
            <div className="cli__cmd">
              {prompt} {h.input}
            </div>
            <pre className="cli__out" data-ok={h.ok}>{visibleLines(h, live).join('\n')}</pre>
          </div>
        ))}
        {busy && <div className="cli__out cli__busy">Running through the simulation engine…</div>}
        {running && <div className="cli__out cli__busy">Replaying in the 3D campus: each line appears when its packet gets back. Press Ctrl+C or Stop to interrupt.</div>}
      </div>
      <form
        className="cli__form"
        onSubmit={(event) => {
          event.preventDefault()
          send(value)
        }}
      >
        <label className="cli__prompt" htmlFor={`cli-${node.id}`}>
          {prompt}
        </label>
        <input
          id={`cli-${node.id}`}
          className="cli__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!online || running}
          maxLength={160}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder={online ? (device ? 'e.g. show access-lists' : 'type a command, e.g. ping 10.0.30.10') : 'engine offline'}
        />
      </form>
      <div className="cli__tools">
        {running && (
          <button type="button" className="chip chip--button" onClick={cancelCli} data-testid="cli-stop">
            Stop (Ctrl+C)
          </button>
        )}
        <div className="chip-row">
          {(device ? DEVICE_SUGGESTIONS : SUGGESTIONS).map((s) => (
            <button key={s} type="button" className="chip chip--button mono" disabled={!online || busy || running} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
        {!device && (
          <label className="demo-check">
            <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
            <span>Replay the packets of a command in the 3D campus</span>
          </label>
        )}
      </div>
    </div>
  )
}
