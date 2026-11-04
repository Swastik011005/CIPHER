import { lazy, Suspense, useMemo } from 'react'

import { ScenarioPanel } from '../features/simulation/ScenarioPanel.jsx'
import { DeviceList } from '../features/simulation/DeviceList.jsx'
import { CablePanel } from '../features/simulation/CablePanel.jsx'
import { DevicePanel } from '../features/simulation/DevicePanel.jsx'
import { PacketList, PacketPanel } from '../features/simulation/PacketPanel.jsx'
import { SendTrafficPanel } from '../features/simulation/SendTrafficPanel.jsx'
import { SimulationViewport } from '../features/simulation/SimulationViewport.jsx'
import { TopologySummary } from '../features/simulation/TopologySummary.jsx'
import { ZonePanel } from '../features/simulation/ZonePanel.jsx'
import '../features/simulation/simulation.css'
import { validateLayout } from '../scene/layout.js'
import { useStore } from '../state/store.js'

/** The separate 3D device viewer: loaded the first time it is opened and mounted only while open. */
const DeviceInspector = lazy(() => import('../features/simulation/DeviceInspector.jsx'))

/** Page 2: the 3D network with its device panel. The primary page of the application. */
export function NetworkSimulation() {
  const topology = useStore((s) => s.topology.data)
  const selectedId = useStore((s) => s.selection.selectedId)
  const packetId = useStore((s) => s.selection.packetId)
  const zoneId = useStore((s) => s.zone.selectedId)
  const cableId = useStore((s) => s.cable.selectedId)
  const inspectorId = useStore((s) => s.inspectorId)
  const layoutIssues = useMemo(() => (topology ? validateLayout(topology) : []), [topology])
  const selectedNode = topology?.nodes.find((n) => n.id === selectedId) ?? null

  return (
    <div className="sim">
      <SimulationViewport layoutIssues={layoutIssues} />
      <aside className="sim__panel" aria-label="Network details">
        {topology && <TopologySummary topology={topology} />}
        {topology && zoneId !== null && <ZonePanel zoneId={zoneId} topology={topology} />}
        {topology && packetId !== null && <PacketPanel pid={packetId} />}
        {topology && packetId === null && cableId !== null && <CablePanel linkId={cableId} topology={topology} />}
        {topology && packetId === null && cableId === null && selectedNode && <DevicePanel node={selectedNode} topology={topology} />}
        {topology && packetId === null && cableId === null && !selectedNode && (
          <>
            <PacketList />
            <DeviceList topology={topology} />
          </>
        )}
        <ScenarioPanel />
        <SendTrafficPanel />
      </aside>
      {topology && inspectorId !== null && (
        <Suspense fallback={null}>
          <DeviceInspector topology={topology} />
        </Suspense>
      )}
    </div>
  )
}
