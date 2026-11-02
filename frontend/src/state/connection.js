/**
 * Backend connection state transitions. Pure functions so they can be unit-tested.
 * The status only ever reflects an actual /api/health result.
 */

/**
 * @typedef {'connecting' | 'online' | 'offline'} ConnectionStatus
 * @typedef {Object} ConnectionState
 * @property {ConnectionStatus} status
 * @property {any | null} health          Last successful /api/health body.
 * @property {string | null} error        Message of the last failed check.
 * @property {number | null} lastCheckedAt
 * @property {number | null} lastOnlineAt
 * @property {number} consecutiveFailures
 */

/** @type {ConnectionState} */
export const initialConnection = Object.freeze({
  status: 'connecting',
  health: null,
  error: null,
  lastCheckedAt: null,
  lastOnlineAt: null,
  consecutiveFailures: 0,
})

/**
 * @param {ConnectionState} prev
 * @param {any} health
 * @param {number} now
 * @returns {ConnectionState}
 */
export function onHealthSuccess(prev, health, now) {
  return {
    ...prev,
    status: 'online',
    health,
    error: null,
    lastCheckedAt: now,
    lastOnlineAt: now,
    consecutiveFailures: 0,
  }
}

/**
 * One failed check is enough to show offline: a stopped backend must be visible quickly.
 * @param {ConnectionState} prev
 * @param {string} message
 * @param {number} now
 * @returns {ConnectionState}
 */
export function onHealthFailure(prev, message, now) {
  return {
    ...prev,
    status: 'offline',
    health: null,
    error: message,
    lastCheckedAt: now,
    consecutiveFailures: prev.consecutiveFailures + 1,
  }
}
