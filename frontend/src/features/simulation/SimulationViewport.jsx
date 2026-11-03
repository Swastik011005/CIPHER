import { RotateCcw, ServerCrash, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CAMERA_PRESETS } from '../../scene/layout.js'
import { useStore } from '../../state/store.js'
import { Banner, Button, Segmented, Spinner } from '../../ui/index.js'
import { PlaybackBar } from './PlaybackBar.jsx'
import { SceneSlot } from './SceneSlot.jsx'

const LABEL_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'selected', label: 'Selected' },
  { value: 'none', label: 'None' },
]
const QUALITY_OPTIONS = [
  { value: 'high', label: 'High', title: 'Ambient occlusion, bloom and shadows' },
  { value: 'low', label: 'Low', title: 'No ambient occlusion, bloom or shadows; for slower GPUs' },
]
const MGMT_OPTIONS = [
  { value: true, label: 'Show' },
  { value: false, label: 'Hide' },
]

function CameraPresetBar() {
  const active = useStore((s) => s.activePreset)
  const requestPreset = useStore((s) => s.requestPreset)
  return (
    <Segmented
      label="Camera presets"
      value={active}
      onChange={requestPreset}
      options={CAMERA_PRESETS.map((p, i) => ({ value: p.id, label: p.label, title: `${p.label} (key ${i + 1})` }))}
    />
  )
}

/** View options, collapsed behind a button so they never cover the scene unless asked for. */
function SceneOptions() {
  const [open, setOpen] = useState(false)
  const settings = useStore((s) => s.settings)
  const setSetting = useStore((s) => s.setSetting)
  return (
    <div className="viewport__options">
      <Button
        size="small"
        icon={<SlidersHorizontal size={14} aria-hidden="true" />}
        aria-expanded={open}
        aria-controls="view-options"
        onClick={() => setOpen((v) => !v)}
      >
        View
      </Button>
      {open && (
        <div id="view-options" className="viewport__options-body">
          <div>
            <div className="eyebrow">Labels</div>
            <Segmented label="Device labels" value={settings.labels} onChange={(v) => setSetting('labels', v)} options={LABEL_OPTIONS} />
          </div>
          <div>
            <div className="eyebrow">Management cables</div>
            <Segmented label="Management cables" value={settings.showManagementLinks} onChange={(v) => setSetting('showManagementLinks', v)} options={MGMT_OPTIONS} />
          </div>
          <div>
            <div className="eyebrow">Quality</div>
            <Segmented label="Render quality" value={settings.quality} onChange={(v) => setSetting('quality', v)} options={QUALITY_OPTIONS} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Frame rate and renderer counters, shown only when the page is opened with ?debug=1. */
function DebugStats() {
  const [stats, setStats] = useState(null)
  useEffect(() => {
    const id = setInterval(() => setStats(window.__netsecScene ?? null), 500)
    return () => clearInterval(id)
  }, [])
  if (!stats) return <div className="viewport__debug mono">waiting for frames…</div>
  return (
    <div className="viewport__debug mono">
      {stats.fps} fps · {stats.meshes} meshes · {Math.round(stats.triangles / 1000)}k tris · {stats.geometries} geo · dpr {stats.pixelRatio}
    </div>
  )
}

/** Keyboard shortcuts for the scene: 1-6 presets, F focus selection, Esc deselect. */
function useSceneShortcuts() {
  useEffect(() => {
    const onKey = (event) => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const store = useStore.getState()
      if (event.key === 'Escape') store.clearSelection()
      else if (event.key.toLowerCase() === 'f' && store.selection.selectedId) store.requestFocus(store.selection.selectedId)
      else if (/^[1-6]$/.test(event.key)) store.requestPreset(CAMERA_PRESETS[Number(event.key) - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * The 3D viewport card: the persistent canvas plus camera controls, view options and the
 * state of the topology load. Nothing here is decorative: every control changes the scene.
 * @param {{layoutIssues: string[]}} props
 */
export function SimulationViewport({ layoutIssues }) {
  const topology = useStore((s) => s.topology)
  const connection = useStore((s) => s.connection)
  const loadTopology = useStore((s) => s.loadTopology)
  const debug = new URLSearchParams(window.location.search).has('debug')
  useSceneShortcuts()

  const hasTopology = Boolean(topology.data)
  const loading = !hasTopology && (topology.status === 'idle' || topology.status === 'loading')
  const failed = !hasTopology && topology.status === 'error'

  return (
    <div className="viewport">
      <SceneSlot />

      <div className="viewport__overlay viewport__overlay--tl glass">
        <CameraPresetBar />
      </div>
      <div className="viewport__overlay viewport__overlay--tr glass">
        <SceneOptions />
      </div>
      <div className="viewport__playback">
        <PlaybackBar />
      </div>
      <div className="viewport__hint">
        DRAG TO ROTATE · RIGHT-DRAG TO PAN · SCROLL TO ZOOM · CLICK A DEVICE · KEYS 1-6 PRESETS · ESC DESELECT
      </div>
      {debug && <DebugStats />}

      {loading && (
        <div className="viewport__center glass">
          <Spinner label="Loading topology" />
          <span>Loading the network topology from the engine…</span>
        </div>
      )}
      {failed && (
        <div className="viewport__center viewport__center--wide">
          <Banner
            tone="danger"
            icon={<ServerCrash size={20} aria-hidden="true" />}
            title="Cannot load the network topology"
            action={
              <Button size="small" icon={<RotateCcw size={14} />} onClick={loadTopology}>
                Retry
              </Button>
            }
          >
            {topology.error}. The 3D scene is built from the backend, so start it with <code>python app.py</code> in the backend folder.
          </Banner>
        </div>
      )}
      {hasTopology && connection.status === 'offline' && (
        <div className="viewport__bottom-banner">
          <Banner tone="warn" title="Engine offline">
            Showing the last topology that was loaded. Reconnecting automatically.
          </Banner>
        </div>
      )}
      {hasTopology && layoutIssues.length > 0 && (
        <div className="viewport__center viewport__center--wide">
          <Banner tone="danger" title="The 3D layout does not match the topology">
            {layoutIssues.slice(0, 4).join('; ')}
            {layoutIssues.length > 4 ? `; and ${layoutIssues.length - 4} more` : ''}
          </Banner>
        </div>
      )}
    </div>
  )
}
