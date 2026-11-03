import { describe, expect, it } from 'vitest'

import { Player, stateAt } from '../../playback/player.js'
import { loadTrace } from '../../playback/testTraces.js'
import { ACTIVITY_DECAY_S, activityAt, radarSpeed } from './activity.js'

describe('device activity', () => {
  it('is full at the moment of the last event and fades to nothing, never negative', () => {
    expect(activityAt({ lastT: 5 }, 5)).toBe(1)
    expect(activityAt({ lastT: 5 }, 5 + ACTIVITY_DECAY_S / 2)).toBeCloseTo(0.5, 9)
    expect(activityAt({ lastT: 5 }, 5 + ACTIVITY_DECAY_S)).toBe(0)
    expect(activityAt({ lastT: 5 }, 99)).toBe(0)
  })

  it('is zero for a device that has done nothing yet, and before an event that is still in the future', () => {
    expect(activityAt(undefined, 3)).toBe(0)
    expect(activityAt({}, 3)).toBe(0)
    expect(activityAt({ lastT: 8 }, 3)).toBe(0) // after seeking back
  })

  it('speeds the IDS-1 radar up with activity', () => {
    expect(radarSpeed(0)).toBeCloseTo(0.8, 9)
    expect(radarSpeed(1)).toBeGreaterThan(radarSpeed(0.5))
    expect(radarSpeed(0.5)).toBeGreaterThan(radarSpeed(0))
  })

  it('follows a real trace: IDS-1 is busy when a SPAN copy arrives, idle long after, and lit state is not left over after a seek', () => {
    const events = loadTrace('s2-enforce').events
    const copy = events.find((e) => e.type === 'packet.hop' && e.to === 'IDS-1')
    const at = (t) => activityAt(stateAt(events, t).nodes['IDS-1'], t)
    expect(at(copy.t - 0.01)).toBe(0) // before the first copy
    expect(at(copy.t_arrive)).toBeGreaterThan(0.9)
    expect(at(copy.t_arrive + 0.3)).toBeGreaterThan(0)
    const player = new Player(events)
    player.seek(copy.t_arrive)
    const lit = activityAt(player.state.nodes['IDS-1'], player.time)
    player.seek(0)
    expect(lit).toBeGreaterThan(0.9)
    expect(activityAt(player.state.nodes['IDS-1'], player.time)).toBe(0) // back at the start nothing is lit
  })

  it('does not light IDS-1 for traffic it never receives, only devices that handled packets', () => {
    const events = loadTrace('s1-monitor').events
    const state = stateAt(events, 3)
    expect(activityAt(state.nodes['EXT-ATK'], 3)).toBe(0) // not part of S1
    expect(activityAt(state.nodes['PC-1'], 0.6)).toBeGreaterThan(0) // PC-1 sends at 0.5 s
  })
})
