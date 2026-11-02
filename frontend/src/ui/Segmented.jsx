import './ui.css'

/**
 * Single-choice button group.
 * @template T
 * @param {{options: {value: T, label: string, title?: string}[], value: T | null, onChange: (value: T) => void, label: string}} props
 */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className="segmented__item"
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
