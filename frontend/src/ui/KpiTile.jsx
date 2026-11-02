import './ui.css'

/**
 * @param {{label: string, value: import('react').ReactNode, hint?: string}} props
 */
export function KpiTile({ label, value, hint }) {
  return (
    <div className="kpi">
      <div className="eyebrow">{label}</div>
      <div className="kpi__value mono">{value}</div>
      {hint && <div className="kpi__hint">{hint}</div>}
    </div>
  )
}
