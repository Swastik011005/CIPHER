import { PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'

import { ROUTES } from './routes.js'
import { ConnectionIndicator } from './StatusCluster.jsx'

const STORAGE_KEY = 'netsec.sidebar.collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Left navigation. Collapses to an icon rail; the choice is remembered when storage is available. */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggle = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(STORAGE_KEY, prev ? '0' : '1')
      } catch {
        /* storage unavailable: the choice just won't persist */
      }
      return !prev
    })
  }

  return (
    <aside className="sidebar" data-collapsed={collapsed} aria-label="Primary">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">
          <ShieldCheck size={20} />
        </span>
        {!collapsed && (
          <div>
            <div className="sidebar__name">NetSec 3D</div>
            <div className="eyebrow">IDS / IPS simulation</div>
          </div>
        )}
      </div>

      <nav className="sidebar__nav">
        {ROUTES.map(({ id, path, label, short, icon: Icon }) => (
          <NavLink key={id} to={path} className="sidebar__link" title={collapsed ? label : undefined}>
            <Icon size={18} aria-hidden="true" />
            {collapsed ? <span className="sr-only">{label}</span> : <span>{short}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__foot">
        <ConnectionIndicator compact={collapsed} />
        {!collapsed && (
          <p className="sidebar__note">
            Local simulation. All traffic is synthetic; nothing is sent to or blocked on a real network.
          </p>
        )}
        <button
          type="button"
          className="sidebar__toggle"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
