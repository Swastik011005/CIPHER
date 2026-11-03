import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api/client.js'

/**
 * The rules as the server holds them, plus the three ways to change them. Nothing is kept here that the server
 * does not confirm: after every edit the rules shown are the ones the server answered with.
 *
 * `feedback` is the outcome of the last action: `{tone: 'ok' | 'danger', title, lines}`.
 */
export function useRules() {
  const [state, setState] = useState({ status: 'loading', rules: null, error: null })
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }))
    try {
      const rules = await api.rules()
      if (alive.current) setState({ status: 'ready', rules, error: null })
    } catch (error) {
      if (alive.current) setState((s) => ({ status: 'error', rules: s.rules, error: error.message }))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** Run one edit; returns true when the server accepted it. */
  const act = useCallback(async (call, success) => {
    setBusy(true)
    setFeedback(null)
    try {
      const response = await call()
      if (!alive.current) return true
      setState({ status: 'ready', rules: response, error: null })
      setFeedback({ tone: 'ok', ...success(response) })
      return true
    } catch (error) {
      if (alive.current) {
        const problems = error.problems?.length ? error.problems : [error.message]
        const refused = error.status === 422 || error.status === 403
        setFeedback({ tone: 'danger', title: refused ? 'The server refused that edit; nothing was changed' : 'The edit could not be sent', lines: problems })
        if (error.status === 403) load() // the server is read-only: show it as it is now
      }
      return false
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [load])

  const applyDetectors = useCallback(
    (changes) =>
      act(
        () => api.putDetectors(changes),
        (r) => ({ title: `Applied ${r.changed.length} change${r.changed.length === 1 ? '' : 's'}. They take effect on the next run.`, lines: r.changed.map((c) => `${c.detector}.${c.field}: ${show(c.from)} → ${show(c.to)}`) }),
      ),
    [act],
  )
  const setRestrictedIps = useCallback(
    (addresses) => act(() => api.putRestrictedIps(addresses), (r) => ({ title: 'Restricted addresses updated. FW1 uses them from the next run.', lines: [r.restricted_ips.addresses.length ? r.restricted_ips.addresses.join(', ') : 'No address is restricted.'] })),
    [act],
  )
  const reset = useCallback(
    () => act(() => api.resetRules(), (r) => ({ title: r.changed.length ? 'Back to the shipped rules.' : 'Already on the shipped rules.', lines: [] })),
    [act],
  )

  return { ...state, feedback, clearFeedback: () => setFeedback(null), busy, reload: load, applyDetectors, setRestrictedIps, reset }
}

const show = (v) => (Array.isArray(v) ? v.join(', ') : String(v))
