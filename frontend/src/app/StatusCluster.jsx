import { offlineAdvice } from '../api/client.js'
import { useStore } from '../state/store.js'
import { Chip, Spinner, StatusDot } from '../ui/index.js'

/**
 * Backend connection indicator. Driven only by real /api/health results.
 * @param {{compact?: boolean}} props
 */
export function ConnectionIndicator({ compact = false }) {
  const connection = useStore((s) => s.connection)
  const { status, error, health, lastCheckedAt } = connection

  const view = {
    online: { tone: 'ok', text: 'Engine online', pulse: true },
    offline: { tone: 'danger', text: 'Engine offline', pulse: false },
    connecting: { tone: 'warn', text: 'Connecting to engine', pulse: true },
  }[status]

  const detail =
    status === 'online'
      ? `Backend ${health?.version ?? ''} reachable (uptime ${health?.uptime_s ?? '?'} s)`
      : status === 'offline'
        ? `${error ?? 'Backend unreachable'}. ${offlineAdvice()}`
        : 'Waiting for the first health check'
  const checked = lastCheckedAt ? ` Last check ${new Date(lastCheckedAt).toLocaleTimeString()}.` : ''

  return (
    <div className="conn" data-status={status} title={detail + checked} role="status" aria-live="polite">
      <StatusDot tone={view.tone} pulse={view.pulse} />
      {compact ? (
        <span className="sr-only">{view.text}</span>
      ) : (
        <span className="conn__text">
          {view.text}
          {status === 'offline' && <span className="conn__sub"> · retrying</span>}
        </span>
      )}
    </div>
  )
}

/** Topology load/validation state from the API. */
export function TopologyStatus() {
  const topology = useStore((s) => s.topology)

  if (topology.status === 'idle' || topology.status === 'loading') {
    return (
      <Chip>
        <Spinner label="Loading topology" /> Topology loading
      </Chip>
    )
  }
  if (!topology.data) {
    return (
      <Chip tone="danger" title={topology.error ?? undefined}>
        Topology unavailable
      </Chip>
    )
  }
  const { summary, validation } = topology.data
  return validation.passed ? (
    <Chip tone="ok" title={`${validation.check_count} topology checks passed`}>
      Topology {summary.nodes} nodes · {summary.links} links · valid
    </Chip>
  ) : (
    <Chip tone="danger" title={`${validation.failed_count} topology checks failed`}>
      Topology invalid
    </Chip>
  )
}

/** Permanent honesty badge: the app only ever runs synthetic traffic. */
export function ModeBadge() {
  return (
    <Chip
      tone="sensor"
      title="Every packet is generated inside the simulation. No real traffic is captured, sent or blocked."
    >
      SIMULATION · synthetic traffic
    </Chip>
  )
}
