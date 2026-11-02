import { describe, expect, it } from 'vitest'

import { DEFAULT_ROUTE, ROUTES, routeForPath } from './routes.js'

describe('application routes', () => {
  it('has the five pages, in sidebar order', () => {
    expect(ROUTES.map((r) => r.id)).toEqual(['overview', 'simulation', 'monitoring', 'threats', 'rules'])
    expect(ROUTES.map((r) => r.label)).toEqual([
      'Overview Dashboard',
      '3D Network Simulation',
      'Network Monitoring',
      'Threat Centre',
      'Security Rules & Scenarios',
    ])
  })

  it('has unique paths and the simulation page as the default', () => {
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(5)
    expect(DEFAULT_ROUTE).toBe('/simulation')
    expect(routeForPath(DEFAULT_ROUTE)?.id).toBe('simulation')
  })

  it('resolves nested paths to their page and unknown paths to nothing', () => {
    expect(routeForPath('/threats/INC-1')?.id).toBe('threats')
    expect(routeForPath('/threatsX')).toBeNull()
    expect(routeForPath('/nope')).toBeNull()
  })

  it('gives every route an icon component', () => {
    for (const route of ROUTES) expect(route.icon).toBeDefined()
  })
})
