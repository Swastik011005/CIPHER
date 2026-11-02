import './ui.css'

/**
 * Titled surface. `eyebrow` is the small tracked label above the title.
 * @param {{eyebrow?: string, title?: string, actions?: import('react').ReactNode, as?: 'h2' | 'h3', className?: string, children?: import('react').ReactNode}} props
 */
export function Card({ eyebrow, title, actions, as: Heading = 'h2', className = '', children }) {
  return (
    <section className={`card ${className}`.trim()}>
      {(eyebrow || title || actions) && (
        <header className="card__head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <Heading>{title}</Heading>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}
