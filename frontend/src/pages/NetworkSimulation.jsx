import { useMemo } from 'react'

import { DeviceList } from '../features/simulation/DeviceList.jsx'
import { DevicePanel } from '../features/simulation/DevicePanel.jsx'
import { SimulationViewport } from '../features/simulation/SimulationViewport.jsx'
import { TopologySummary } from '../features/simulation/TopologySummary.jsx'
import '../features/simulation/simulation.css'
import { validateLayout } from '../scene/layout.js'
import { useStore } from '../state/store.js'
import { Card, Chip } from '../ui/index.js'

/** Explains what the viewport can and cannot do yet, using what the engine reports it has. */
function ScenarioNote() {
  const health = useStore((s) => s.connection.health)
  const available = health?.scenarios_available ?? []
  return (
    <Card eyebrow="Scenarios" title="Traffic playback" as="h3">
      <p className="muted">
        Playing scenarios in the scene arrives in a later stage. The engine already produces a deterministic trace for
        the scenarios below; this view shows the network they run on.
      </p>
      <div className="chip-row chip-row--top">
        {available.length > 0 ? (
          available.map((id) => (
            <Chip key={id} tone="ok" mono>
              {id} available
            </Chip>
          ))
        ) : (
          <Chip>Engine not reporting scenarios</Chip>
        )}
      </div>
    </Card>
  )
}

/** Page 2: the 3D network with its device panel. The primary page of the application. */
export function NetworkSimulation() {
  const topology = useStore((s) => s.topology.data)
  const selectedId = useStore((s) => s.selection.selectedId)
  const layoutIssues = useMemo(() => (topology ? validateLayout(topology) : []), [topology])
  const selectedNode = topology?.nodes.find((n) => n.id === selectedId) ?? null

  return (
    <div className="sim">
      <SimulationViewport layoutIssues={layoutIssues} />
      <aside className="sim__panel" aria-label="Network details">
        {topology && <TopologySummary topology={topology} />}
        {topology && (selectedNode ? <DevicePanel node={selectedNode} topology={topology} /> : <DeviceList topology={topology} />)}
        <ScenarioNote />
      </aside>
    </div>
  )
}
