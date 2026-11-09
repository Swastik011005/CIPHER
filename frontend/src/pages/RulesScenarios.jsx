import { Lock, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { DetectionTab } from '../features/rules/DetectionTab.jsx'
import { FirewallTab } from '../features/rules/FirewallTab.jsx'
import { PreventionTab } from '../features/rules/PreventionTab.jsx'
import { ScenariosTab } from '../features/rules/ScenariosTab.jsx'
import { readOnlyNotice, rulesStatus } from '../features/rules/rulesLogic.js'
import { useRules } from '../features/rules/useRules.js'
import '../features/rules/rules.css'
import { Banner, Button, Card, Chip, EngineHint, Segmented, Spinner } from '../ui/index.js'
import './pages.css'

const TABS = [
  { value: 'firewall', label: 'Firewall & ACL' },
  { value: 'detection', label: 'Detection (IDS)' },
  { value: 'prevention', label: 'Prevention (IPS)' },
  { value: 'scenarios', label: 'Scenarios & checks' },
]

/**
 * Page 5: the rules the engine runs with and the scenarios that exercise them. Every edit is sent to the
 * backend, validated there and stored there; the next run (from this page or the 3D simulation) uses it.
 */
export function RulesScenarios() {
  const rules = useRules()
  const [tab, setTab] = useState('detection')
  const status = rulesStatus(rules.rules)
  const locked = readOnlyNotice(rules.rules)

  return (
    <div className="page rules-page">
      <div className="rules-head">
        <Segmented label="Rules sections" value={tab} onChange={(next) => { setTab(next); rules.clearFeedback() }} options={TABS} />
        {rules.rules && (
          <div className="rules-status" data-customised={status.customised}>
            <Chip tone={status.customised ? 'warn' : 'ok'}>{status.customised ? 'Custom rules' : 'Shipped rules'}</Chip>
            {locked && (
              <Chip tone="sensor" title={locked.title}>
                <Lock size={12} aria-hidden="true" /> Read-only
              </Chip>
            )}
            <span className="muted">{status.text}</span>
            <span className="muted mono" title="Digest of every rule; it is part of each run's config hash">
              rules {rules.rules.rules_hash}
            </span>
            {!locked && (
              <Button size="small" icon={<RotateCcw size={14} />} disabled={!status.customised || rules.busy} onClick={rules.reset}>
                Reset to shipped
              </Button>
            )}
          </div>
        )}
      </div>

      {locked && (
        <Banner tone="info" icon={<Lock size={20} aria-hidden="true" />} title={locked.title}>
          {locked.text}
        </Banner>
      )}

      {rules.feedback && (
        <Banner
          tone={rules.feedback.tone}
          title={rules.feedback.title}
          action={
            <Button size="small" variant="ghost" onClick={rules.clearFeedback}>
              Dismiss
            </Button>
          }
        >
          {rules.feedback.lines.length > 0 && (
            <ul className="feedback-lines">
              {rules.feedback.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </Banner>
      )}

      {rules.status === 'loading' && !rules.rules && (
        <Card>
          <div className="inline-status">
            <Spinner /> <span className="muted">Loading the rules from the engine…</span>
          </div>
        </Card>
      )}
      {rules.status === 'error' && (
        <Banner tone="danger" title="Cannot load the rules" action={<Button size="small" onClick={rules.reload}>Retry</Button>}>
          {rules.error}.{' '}
          <EngineHint local={<>The rules live in the backend, so start it with <code>python app.py</code> in the backend folder.</>} />
        </Banner>
      )}

      {rules.rules && tab === 'firewall' && <FirewallTab rules={rules.rules} busy={rules.busy} readOnly={Boolean(locked)} onRestricted={rules.setRestrictedIps} />}
      {rules.rules && tab === 'detection' && <DetectionTab rules={rules.rules} busy={rules.busy} readOnly={Boolean(locked)} onApply={rules.applyDetectors} />}
      {rules.rules && tab === 'prevention' && <PreventionTab rules={rules.rules} detectors={rules.rules.detectors} />}
      {tab === 'scenarios' && <ScenariosTab customised={status.customised} />}
    </div>
  )
}
