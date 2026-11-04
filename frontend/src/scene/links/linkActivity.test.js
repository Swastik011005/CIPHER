import { beforeEach, describe, expect, it } from 'vitest'

import { linkSeverity, noteLinkSeverity, severityOf } from './linkActivity.js'
import { currentHop } from './linkPaths.js'

describe('link severity', () => {
  beforeEach(() => linkSeverity.clear())

  it('keeps the highest severity noted for a link in a frame', () => {
    noteLinkSeverity('L06', 1)
    noteLinkSeverity('L06', 2)
    noteLinkSeverity('L06', 1)
    noteLinkSeverity('L07', 1)
    expect(linkSeverity.get('L06')).toBe(2)
    expect(linkSeverity.get('L07')).toBe(1)
    expect(linkSeverity.get('L08')).toBeUndefined()
  })

  it('only flagged and blocked verdicts count; neutral, allowed and mirror copies do not', () => {
    expect(['neutral', 'allowed', 'mirror', 'flagged', 'dropped'].map(severityOf)).toEqual([0, 0, 0, 1, 2])
  })
})

describe('currentHop', () => {
  const hops = [
    { link: 'L1', from: 'A', t: 0, tArrive: 1 },
    { link: 'L2', from: 'B', t: 1, tArrive: 2 },
  ]
  it('finds the hop in progress, stays on the last hop after arrival, and has none before the first hop', () => {
    expect(currentHop(hops, 0.5).link).toBe('L1')
    expect(currentHop(hops, 1.5).link).toBe('L2')
    expect(currentHop(hops, 9).link).toBe('L2')
    expect(currentHop([], 1)).toBeNull()
  })
})
