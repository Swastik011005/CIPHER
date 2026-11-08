import { useEffect, useRef, useState } from 'react'

import { useStore } from '../../state/store.js'

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
  }, [history.length, busy])

  const send = async (text) => {
    if (!text.trim() || busy) return
    setBusy(true)
    setBack(-1)
    setValue('')
    await runCli(node.id, text, animate)
    setBusy(false)
  }

  const onKeyDown = (event) => {
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
            <pre className="cli__out" data-ok={h.ok}>{h.lines.join('\n')}</pre>
          </div>
        ))}
        {busy && <div className="cli__out cli__busy">Running through the simulation engine…</div>}
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
          disabled={!online}
          maxLength={160}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder={online ? (device ? 'e.g. show access-lists' : 'type a command, e.g. ping 10.0.30.10') : 'engine offline'}
        />
      </form>
      <div className="cli__tools">
        <div className="chip-row">
          {(device ? DEVICE_SUGGESTIONS : SUGGESTIONS).map((s) => (
            <button key={s} type="button" className="chip chip--button mono" disabled={!online || busy} onClick={() => send(s)}>
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
