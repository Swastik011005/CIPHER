import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './AppShell.jsx'
import { DEFAULT_ROUTE } from './routes.js'
import { NetworkMonitoring } from '../pages/NetworkMonitoring.jsx'
import { NetworkSimulation } from '../pages/NetworkSimulation.jsx'
import { OverviewDashboard } from '../pages/OverviewDashboard.jsx'
import { RulesScenarios } from '../pages/RulesScenarios.jsx'
import { ThreatCentre } from '../pages/ThreatCentre.jsx'

/** Route table. Pages are mounted inside AppShell, which owns the persistent 3D canvas. */
export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={DEFAULT_ROUTE} replace />} />
        <Route path="overview" element={<OverviewDashboard />} />
        <Route path="simulation" element={<NetworkSimulation />} />
        <Route path="monitoring" element={<NetworkMonitoring />} />
        <Route path="threats" element={<ThreatCentre />} />
        <Route path="rules" element={<RulesScenarios />} />
        <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
      </Route>
    </Routes>
  )
}
