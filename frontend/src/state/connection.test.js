import { describe, expect, it } from 'vitest'

import { initialConnection, onHealthFailure, onHealthSuccess } from './connection.js'

describe('connection state', () => {
  it('starts as connecting with nothing known', () => {
    expect(initialConnection).toMatchObject({ status: 'connecting', health: null, lastOnlineAt: null, consecutiveFailures: 0 })
  })

  it('goes online on a successful health check and keeps the body', () => {
    const health = { status: 'ok', version: '0.1.0' }
    const state = onHealthSuccess(initialConnection, health, 1000)
    expect(state).toMatchObject({ status: 'online', health, error: null, lastCheckedAt: 1000, lastOnlineAt: 1000 })
  })

  it('goes offline after a single failure and drops the stale health body', () => {
    const online = onHealthSuccess(initialConnection, { status: 'ok' }, 1000)
    const offline = onHealthFailure(online, 'Cannot reach the backend', 4000)
    expect(offline).toMatchObject({
      status: 'offline',
      health: null,
      error: 'Cannot reach the backend',
      lastCheckedAt: 4000,
      lastOnlineAt: 1000, // remembered, so the UI can say when it was last seen
      consecutiveFailures: 1,
    })
  })

  it('counts consecutive failures and resets them on recovery', () => {
    let state = onHealthFailure(initialConnection, 'down', 1)
    state = onHealthFailure(state, 'down', 2)
    expect(state.consecutiveFailures).toBe(2)
    state = onHealthSuccess(state, { status: 'ok' }, 3)
    expect(state).toMatchObject({ status: 'online', consecutiveFailures: 0, error: null })
  })

  it('does not mutate the previous state', () => {
    const before = { ...initialConnection }
    onHealthFailure(initialConnection, 'x', 1)
    expect(initialConnection).toEqual(before)
  })
})
