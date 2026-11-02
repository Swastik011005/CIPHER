import './ui.css'

/**
 * @param {{variant?: 'default' | 'primary' | 'ghost', size?: 'default' | 'small', icon?: import('react').ReactNode} & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function Button({ variant = 'default', size = 'default', icon, className = '', children, type = 'button', ...rest }) {
  const classes = ['btn', variant !== 'default' && `btn--${variant}`, size === 'small' && 'btn--small', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  )
}
