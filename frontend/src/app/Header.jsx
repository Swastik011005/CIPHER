import { useLocation } from 'react-router-dom'

import { routeForPath } from './routes.js'
import { ConnectionIndicator, ModeBadge, TopologyStatus } from './StatusCluster.jsx'

/** Page title on the left, live status indicators on the right. */
export function Header() {
  const { pathname } = useLocation()
  const route = routeForPath(pathname)

  return (
    <header className="header">
      <div>
        <div className="eyebrow eyebrow--accent">{route?.eyebrow ?? 'CIPHER'}</div>
        <h1>{route?.label ?? 'CIPHER'}</h1>
      </div>
      <div className="header__status">
        <TopologyStatus />
        <ConnectionIndicator />
        <ModeBadge />
      </div>
    </header>
  )
}
