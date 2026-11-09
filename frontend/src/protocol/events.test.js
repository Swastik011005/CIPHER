import { describe, expect, it } from 'vitest'

import { loadEventContract } from '../scene/testSupport.js'
import { BASE_FIELDS, EVENT_FIELDS, EVENT_TYPES, STATS_FIELDS } from './events.js'

const contract = loadEventContract()

describe('event protocol matches contracts/events.json', () => {
  it('lists the same event types in the same order', () => {
    expect(EVENT_TYPES).toEqual(Object.keys(contract.events))
    expect(EVENT_TYPES).toHaveLength(19) // the 14 frozen events plus zt.decision, edr.alert, edr.state, siem.event
  })

  it('lists the same fields for every event', () => {
    expect(EVENT_FIELDS).toEqual(contract.events)
  })

  it('uses the same base fields and run statistics', () => {
    expect([...BASE_FIELDS]).toEqual(contract.base_fields)
    expect([...STATS_FIELDS]).toEqual(contract.stats_fields)
  })

  it('keeps IDS and IPS alerts distinguishable and correlatable', () => {
    expect(EVENT_FIELDS['alert.raised']).toEqual(expect.arrayContaining(['sensor', 'incident_id', 'alert_id']))
    expect(contract.enums.sensor).toEqual(['IDS-1', 'IPS-1'])
  })

  it('is frozen so it cannot be changed by accident', () => {
    expect(Object.isFrozen(EVENT_TYPES)).toBe(true)
    expect(Object.isFrozen(EVENT_FIELDS)).toBe(true)
  })
})
