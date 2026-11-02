import { Activity, Box, LayoutDashboard, ShieldAlert, SlidersHorizontal } from 'lucide-react'

/**
 * The five application pages. Order is the sidebar order.
 * @typedef {Object} AppRoute
 * @property {string} id
 * @property {string} path
 * @property {string} label    Page title.
 * @property {string} short    Short name for compact UI.
 * @property {string} eyebrow  Small label above the title.
 * @property {import('react').ComponentType<any>} icon
 */

/** @type {AppRoute[]} */
export const ROUTES = [
  { id: 'overview', path: '/overview', label: 'Overview Dashboard', short: 'Overview', eyebrow: 'Network security lab', icon: LayoutDashboard },
  { id: 'simulation', path: '/simulation', label: '3D Network Simulation', short: 'Simulation', eyebrow: 'Live scene', icon: Box },
  { id: 'monitoring', path: '/monitoring', label: 'Network Monitoring', short: 'Monitoring', eyebrow: 'Operations', icon: Activity },
  { id: 'threats', path: '/threats', label: 'Threat Centre', short: 'Threats', eyebrow: 'Detection and prevention', icon: ShieldAlert },
  { id: 'rules', path: '/rules', label: 'Security Rules & Scenarios', short: 'Rules', eyebrow: 'Policy and testing', icon: SlidersHorizontal },
]

export const DEFAULT_ROUTE = '/simulation'

/** @param {string} pathname */
export function routeForPath(pathname) {
  return ROUTES.find((r) => pathname === r.path || pathname.startsWith(`${r.path}/`)) ?? null
}
