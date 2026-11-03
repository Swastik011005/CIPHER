import { useEffect, useMemo, useState } from 'react'

import { Button, Chip } from '../../ui/index.js'
import { SIGNATURES, SIGNATURE_LABELS, buildChanges, fieldLabel, initialDraft, numericFields } from './rulesLogic.js'

/** One switch, styled as a switch, announced as one. */
function Switch({ checked, onChange, label }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="switch__track" aria-hidden="true" />
      <span className="switch__text">{checked ? 'On' : 'Off'}</span>
    </label>
  )
}

function DetectorCard({ id, detector, draft, errors, onChange }) {
  const enabled = draft.enabled
  return (
    <section className="detector card" data-enabled={enabled} aria-label={`${id} ${detector.name}`}>
      <header className="detector__head">
        <div>
          <div className="eyebrow">
            {id} · {detector.mitre}
          </div>
          <h3>{detector.name}</h3>
        </div>
        <Switch checked={enabled} onChange={(v) => onChange({ enabled: v })} label={`Enable ${id} ${detector.name}`} />
      </header>
      <p className="muted detector__text">{detector.detects}.</p>
      <p className="detector__where">Seen by: {detector.where}</p>

      <div className="detector__fields" aria-disabled={!enabled}>
        {numericFields(detector).map((field) => {
          const { label, unit } = fieldLabel(id, field)
          const key = `${id}.${field}`
          const limit = detector.limits[field]
          const changed = String(detector.settings[field]) !== String(draft[field])
          return (
            <label key={field} className="field" data-changed={changed}>
              <span className="field__label">
                {label} {unit && <span className="muted">({unit})</span>}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={draft[field]}
                onChange={(e) => onChange({ [field]: e.target.value })}
                aria-invalid={Boolean(errors[key])}
                aria-describedby={errors[key] ? `${key}-err` : undefined}
                aria-label={`${id} ${label}`}
              />
              <span className="field__hint muted">
                shipped {detector.defaults[field]} · allowed {limit.min} to {limit.max}
              </span>
              {errors[key] && (
                <span id={`${key}-err`} className="field__error" role="alert">
                  {errors[key]}
                </span>
              )}
            </label>
          )
        })}

        {'ports' in draft && (
          <label className="field" data-changed={draft.ports !== detector.settings.ports.join(', ')}>
            <span className="field__label">Ports watched</span>
            <input type="text" value={draft.ports} onChange={(e) => onChange({ ports: e.target.value })} aria-invalid={Boolean(errors[`${id}.ports`])} aria-label={`${id} ports`} />
            <span className="field__hint muted">shipped {detector.defaults.ports.join(', ')} · up to 10</span>
            {errors[`${id}.ports`] && (
              <span className="field__error" role="alert">
                {errors[`${id}.ports`]}
              </span>
            )}
          </label>
        )}

        {'signatures' in draft && (
          <fieldset className="field">
            <legend className="field__label">Signatures</legend>
            <div className="sig-list">
              {SIGNATURES.map((sig) => (
                <label key={sig} className="check">
                  <input
                    type="checkbox"
                    checked={draft.signatures.includes(sig)}
                    onChange={(e) => onChange({ signatures: e.target.checked ? [...draft.signatures, sig] : draft.signatures.filter((s) => s !== sig) })}
                  />
                  {SIGNATURE_LABELS[sig]}
                </label>
              ))}
            </div>
            {errors[`${id}.signatures`] && (
              <span className="field__error" role="alert">
                {errors[`${id}.signatures`]}
              </span>
            )}
          </fieldset>
        )}

        {id === 'D4' && (
          <p className="muted field__note">
            Restricted service: {detector.settings.services.map((s) => `${s.name} ${s.dst}:${s.dport}, allowed from ${s.allowed_sources.join(', ')}`).join('; ')}.
          </p>
        )}
        {id === 'D5' && (
          <p className="muted field__note">Forbidden pairs: {detector.settings.pairs.map((p) => `${p.src} → ${p.dst}`).join('; ')}.</p>
        )}
      </div>
      {detector.changed.length > 0 && (
        <div className="detector__changed">
          <Chip tone="warn">Changed from shipped: {detector.changed.join(', ')}</Chip>
        </div>
      )}
    </section>
  )
}

/**
 * The detector settings: switches and thresholds, one draft for all of them, applied together (the server
 * accepts all of an edit or none of it).
 */
export function DetectionTab({ rules, busy, onApply, readOnly = false }) {
  const [draft, setDraft] = useState(() => initialDraft(rules.detectors))
  // A new server state (after Apply or Reset) replaces the draft.
  useEffect(() => setDraft(initialDraft(rules.detectors)), [rules])

  const { changes, errors, count } = useMemo(() => buildChanges(rules.detectors, draft), [rules, draft])
  const blocked = Object.keys(errors).length > 0
  const edit = (id) => (patch) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }))

  return (
    <>
      {/* A disabled fieldset disables every switch and field inside it, for the mouse, the keyboard and screen readers. */}
      <fieldset className="rules-lock" disabled={readOnly} data-locked={readOnly}>
        <legend className="sr-only">Detector settings{readOnly ? ' (read-only on this server)' : ''}</legend>
        <div className="detector-grid">
          {Object.entries(rules.detectors).map(([id, detector]) => (
            <DetectorCard key={id} id={id} detector={detector} draft={draft[id]} errors={errors} onChange={edit(id)} />
          ))}
        </div>
      </fieldset>
      <div className="apply-bar glass" role="region" aria-label="Pending detector changes" data-pending={count > 0 && !readOnly}>
        <span>
          {readOnly && 'Read-only: these settings are shown but cannot be changed on this server.'}
          {!readOnly && count === 0 && !blocked && 'No unsaved changes. Edits apply to the next run.'}
          {!readOnly && count > 0 && !blocked && `${count} unsaved change${count === 1 ? '' : 's'}`}
          {!readOnly && blocked && `${Object.keys(errors).length} value${Object.keys(errors).length === 1 ? '' : 's'} to fix before applying`}
        </span>
        <span className="apply-bar__buttons">
          <Button size="small" variant="ghost" disabled={readOnly || (count === 0 && !blocked)} onClick={() => setDraft(initialDraft(rules.detectors))}>
            Discard
          </Button>
          <Button variant="primary" size="small" disabled={readOnly || count === 0 || blocked || busy} onClick={() => onApply(changes)}>
            Apply
          </Button>
        </span>
      </div>
    </>
  )
}
