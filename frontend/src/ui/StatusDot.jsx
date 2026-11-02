import './ui.css'

/**
 * @param {{tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'sensor' | 'accent', pulse?: boolean, label?: string}} props
 */
export function StatusDot({ tone = 'neutral', pulse = false, label }) {
  const classes = ['dot', tone !== 'neutral' && `dot--${tone}`, pulse && 'dot--pulse'].filter(Boolean).join(' ')
  return <span className={classes} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}
