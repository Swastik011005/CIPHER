import './ui.css'

/**
 * Inline message. Use tone "danger" for failures, "warn" for degraded states, "info" for notes.
 * @param {{tone?: 'danger' | 'warn' | 'info', title: string, children?: import('react').ReactNode, action?: import('react').ReactNode, icon?: import('react').ReactNode}} props
 */
export function Banner({ tone = 'info', title, children, action, icon }) {
  return (
    <div className={`banner banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon}
      <div className="banner__body">
        <div className="banner__title">{title}</div>
        {children && <div className="muted">{children}</div>}
      </div>
      {action}
    </div>
  )
}
