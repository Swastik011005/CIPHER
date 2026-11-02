import './ui.css'

/**
 * @param {{icon?: import('react').ReactNode, title: string, children?: import('react').ReactNode}} props
 */
export function EmptyState({ icon, title, children }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}
