import { useMemo } from 'react'

import { ScenarioPanel } from '../features/simulation/ScenarioPanel.jsx'
import { DeviceList } from '../features/simulation/DeviceList.jsx'
import { DevicePanel } from '../features/simulation/DevicePanel.jsx'
import { PacketList, PacketPanel } from '../features/simulation/PacketPanel.jsx'
import { SimulationViewport } from '../features/simulation/SimulationViewport.jsx'
import { TopologySummary } from '../features/simulation/TopologySummary.jsx'
import '../features/simulation/simulation.css'
import { validateLayout } from '../scene/layout.js'
import { useStore } from '../state/store.js'

/** Page 2: the 3D network with its device panel. The primary page of the application. */
export function NetworkSimulation() {
  const topology = useStore((s) => s.topology.data)
  const selectedId = useStore((s) => s.selection.selectedId)
  const packetId = useStore((s) => s.selection.packetId)
  const layoutIssues = useMemo(() => (topology ? validateLayout(topology) : []), [topology])
  const selectedNode = topology?.nodes.find((n) => n.id === selectedId) ?? null

  return (
    <div className="sim">
      <SimulationViewport layoutIssues={layoutIssues} />
      <aside className="sim__panel" aria-label="Network details">
        {topology && <TopologySummary topology={topology} />}
        {topology && packetId !== null && <PacketPanel pid={packetId} />}
        {topology && packetId === null && selectedNode && <DevicePanel node={selectedNode} topology={topology} />}
        {topology && packetId === null && !selectedNode && (
          <>
            <PacketList />
            <DeviceList topology={topology} />
          </>
        )}
        <ScenarioPanel />
      </aside>
    </div>
  )
}
