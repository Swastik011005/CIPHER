import { labelAddress } from '../../scene/deviceInfo.js'
import { useStore } from '../../state/store.js'
import { Card } from '../../ui/index.js'

/**
 * Keyboard-accessible list of every device, grouped by zone. Selecting an item selects the
 * device and moves the camera to it, so the scene can be explored without the mouse.
 * @param {{topology: any}} props
 */
export function DeviceList({ topology }) {
  const select = useStore((s) => s.select)
  const requestFocus = useStore((s) => s.requestFocus)

  return (
    <Card eyebrow="Devices" title="Network devices">
      <div className="device-list">
        {topology.zones.map((zone) => {
          const nodes = topology.nodes.filter((n) => n.zone === zone.id)
          if (nodes.length === 0) return null
          return (
            <div key={zone.id} className="device-list__group">
              <div className="eyebrow">{zone.name}</div>
              {nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className="device-list__item"
                  onClick={() => {
                    select(node.id)
                    requestFocus(node.id)
                  }}
                >
                  <span>{node.label}</span>
                  <span className="mono muted">{labelAddress(node)}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
