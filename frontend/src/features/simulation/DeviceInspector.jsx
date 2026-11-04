import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { describeInterfaces, labelAddress, neighboursOf } from '../../scene/deviceInfo.js'
import { InspectorCanvas } from '../../scene/inspector/InspectorCanvas.jsx'
import { MODEL_NAMES, modelKeyOfNode } from '../../scene/inspector/modelInfo.js'
import { NODE_LAYOUT } from '../../scene/layout.js'
import { useStore } from '../../state/store.js'
import { Button, Chip } from '../../ui/index.js'

const TYPE_LABELS = {
  host: 'Host',
  router: 'Router',
  l3switch: 'Layer 3 switch',
  l2switch: 'Layer 2 switch',
  firewall: 'Firewall',
  ids: 'IDS sensor',
  ips: 'IPS',
  syslog: 'Syslog collector',
  segment: 'Network segment',
}

/**
 * The separate 3D device viewer: a dialog with its own canvas, camera and information panel. It draws the same model
 * components as the campus (not a second set of models) and is mounted only while open, so it costs nothing otherwise.
 * It never touches the campus camera, the packet selection or playback: opening and closing it leaves them as they were.
 * Keys: Esc closes, R resets the camera, the arrow keys show the previous or next device.
 * @param {{topology: any}} props
 */
export default function DeviceInspector({ topology }) {
  const inspectorId = useStore((s) => s.inspectorId)
  const quality = useStore((s) => s.settings.quality)
  const openInspector = useStore((s) => s.openInspector)
  const closeInspector = useStore((s) => s.closeInspector)
  const canvas = useRef(null)
  const closeButton = useRef(null)
  const dialog = useRef(null)

  const nodes = topology.nodes.filter((n) => NODE_LAYOUT[n.id])
  const index = nodes.findIndex((n) => n.id === inspectorId)
  const node = nodes[index] ?? null
  const step = (delta) => openInspector(nodes[(index + delta + nodes.length) % nodes.length].id)

  // Focus goes into the dialog and returns to where it was when the dialog closes.
  useEffect(() => {
    const before = document.activeElement
    closeButton.current?.focus()
    return () => {
      if (before instanceof HTMLElement && document.contains(before)) before.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeInspector()
      } else if (event.key === 'ArrowRight') step(1)
      else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey) canvas.current?.reset()
      else if (event.key === 'Tab' && dialog.current) {
        // keep Tab inside the dialog
        const items = [...dialog.current.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled)
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!node) return null
  const key = modelKeyOfNode(node)
  const interfaces = describeInterfaces(node, topology)
  const neighbours = neighboursOf(node, topology)
  const zone = topology.zones.find((z) => z.id === node.zone)

  return (
    <div className="inspector" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeInspector()}>
      <div className="inspector__dialog" role="dialog" aria-modal="true" aria-label={`3D viewer: ${node.label}`} ref={dialog}>
        <header className="inspector__header">
          <div>
            <div className="eyebrow">3D device viewer</div>
            <h2 className="inspector__title">{node.label}</h2>
            <div className="muted inspector__model">
              {MODEL_NAMES[key]} <span className="mono">· model {key}</span>
            </div>
          </div>
          <div className="panel-actions">
            <Button size="small" variant="ghost" icon={<ChevronLeft size={14} />} onClick={() => step(-1)} aria-label="Previous device" title="Previous device (left arrow)" />
            <Button size="small" variant="ghost" icon={<ChevronRight size={14} />} onClick={() => step(1)} aria-label="Next device" title="Next device (right arrow)" />
            <Button size="small" icon={<RotateCcw size={14} />} onClick={() => canvas.current?.reset()} title="Reset the viewer camera (R)">
              Reset camera
            </Button>
            <button type="button" className="inspector__close" onClick={closeInspector} aria-label="Close the viewer" title="Close (Esc)" ref={closeButton}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="inspector__body">
          <div className="inspector__stage">
            <InspectorCanvas ref={canvas} node={node} quality={quality} />
            <div className="inspector__hint">DRAG TO ROTATE · SCROLL TO ZOOM · RIGHT-DRAG TO PAN · R RESETS · ESC CLOSES</div>
          </div>

          <aside className="inspector__info" aria-label="Device information">
            <div className="chip-row">
              <Chip tone="accent">{TYPE_LABELS[node.type] ?? node.type}</Chip>
              {zone && <Chip>{zone.name}</Chip>}
              <Chip mono>{labelAddress(node)}</Chip>
            </div>
            <p className="device-role">{node.role}</p>
            <p className="muted device-description">{node.description}</p>

            <h3 className="panel-heading">Interfaces</h3>
            <table className="table table--compact">
              <tbody>
                {interfaces.map((i) => (
                  <tr key={i.name}>
                    <td className="mono">{i.name}</td>
                    <td className="mono">{i.address ?? '—'}</td>
                    <td>{i.attachment}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {node.services.length > 0 && (
              <>
                <h3 className="panel-heading">Services</h3>
                <div className="chip-row">
                  {node.services.map((s) => (
                    <Chip key={`${s.proto}${s.port}`} mono>
                      {s.proto}/{s.port} {s.name}
                    </Chip>
                  ))}
                </div>
              </>
            )}

            <h3 className="panel-heading">Connected to</h3>
            <div className="chip-row">
              {neighbours.map((n) => (
                <Chip key={n.linkId} mono title={`${n.linkId}: ${n.localIface} to ${n.peerIface}`}>
                  {n.peer.label}
                </Chip>
              ))}
            </div>
            <p className="muted device-description">The model is the same one that stands in the campus. Everything shown is synthetic.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}
