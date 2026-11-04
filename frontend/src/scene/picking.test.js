import { describe, expect, it } from 'vitest'

import { PICK, isTopPick, topPriority } from './picking.js'

const hit = (pick) => ({ eventObject: { userData: { pick } }, object: {} })

describe('pick priority', () => {
  it('orders packet above device above cable above zone above ground', () => {
    expect(PICK.packet).toBeGreaterThan(PICK.device)
    expect(PICK.device).toBeGreaterThan(PICK.cable)
    expect(PICK.cable).toBeGreaterThan(PICK.zone)
    expect(PICK.zone).toBeGreaterThan(PICK.ground)
  })

  it('a device inside a pavilion wins over the pavilion, wherever the pavilion lies on the ray', () => {
    for (const order of [[hit('zone'), hit('device'), hit('ground')], [hit('device'), hit('zone'), hit('ground')]]) {
      expect(isTopPick({ intersections: order }, 'device')).toBe(true)
      expect(isTopPick({ intersections: order }, 'zone')).toBe(false)
      expect(isTopPick({ intersections: order }, 'ground')).toBe(false)
    }
  })

  it('a cable wins over a zone, a zone over the ground, and the ground only wins alone', () => {
    expect(isTopPick({ intersections: [hit('zone'), hit('cable')] }, 'cable')).toBe(true)
    expect(isTopPick({ intersections: [hit('zone'), hit('cable')] }, 'zone')).toBe(false)
    expect(isTopPick({ intersections: [hit('ground'), hit('zone')] }, 'zone')).toBe(true)
    expect(isTopPick({ intersections: [hit('ground')] }, 'ground')).toBe(true)
  })

  it('a packet is picked before the device it is passing', () => {
    expect(isTopPick({ intersections: [hit('device'), hit('packet')] }, 'packet')).toBe(true)
    expect(isTopPick({ intersections: [hit('device'), hit('packet')] }, 'device')).toBe(false)
  })

  it('ignores objects that are not pickable kinds and handles an empty ray', () => {
    expect(topPriority([{ eventObject: { userData: {} }, object: {} }])).toBe(-1)
    expect(topPriority(undefined)).toBe(-1)
    expect(isTopPick({}, 'ground')).toBe(true)
  })
})
