import './ui.css'

/**
 * Small status/label pill.
 * @param {{tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'sensor' | 'info' | 'accent', mono?: boolean, className?: string, children?: import('react').ReactNode, title?: string}} props
 */
export function Chip({ tone = 'neutral', mono = false, className = '', children, title }) {
  const classes = ['chip', tone !== 'neutral' && `chip--${tone}`, mono && 'chip--mono', className]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  )
}
