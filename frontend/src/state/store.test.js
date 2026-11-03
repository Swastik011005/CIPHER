import { beforeEach, describe, expect, it } from 'vitest'

import { session } from '../playback/session.js'
import { loadTrace } from '../playback/testTraces.js'
import { useStore } from './store.js'

const store = () => useStore.getState()

describe('selection', () => {
  beforeEach(() => {
    store().clearSelection()
  })

  it('selecting a packet clears the device selection and vice versa', () => {
    store().select('IPS-1')
    expect(store().selection).toMatchObject({ selectedId: 'IPS-1', packetId: null })
    store().selectPacket(26)
    expect(store().selection).toMatchObject({ selectedId: null, packetId: 26 })
    store().select('PC-2')
    expect(store().selection).toMatchObject({ selectedId: 'PC-2', packetId: null })
  })

  it('clearSelection clears both, and select(null) alone keeps a selected packet', () => {
    store().selectPacket(7)
    store().select(null)
    expect(store().selection.packetId).toBe(7)
    store().clearSelection()
    expect(store().selection).toMatchObject({ selectedId: null, packetId: null })
  })
})

describe('playback mirrored into the store', () => {
  beforeEach(() => {
    session.load(loadTrace('s2-enforce'))
    store().syncPlayback()
  })

  it('reflects seek, pause, replay and restart without stale state', () => {
    store().seekTo(10)
    expect(store().playback.time).toBe(10)
    expect(store().playback.state.counts.alerts).toBe(4)
    expect(Object.keys(store().playback.state.blocks)).toEqual(['10.0.10.12'])

    store().seekTo(2) // backwards
    expect(store().playback.state.counts.alerts).toBe(0)
    expect(store().playback.state.blocks).toEqual({})
    expect(store().playback.state.nodes['IPS-1']?.dropped ?? 0).toBe(0)

    store().seekTo(session.player.duration)
    expect(store().playback.finished).toBe(true)
    expect(store().playback.state.counts).toEqual(store().playback.state.finalStats)

    store().restartPlayback() // replay after the end
    expect(store().playback.time).toBe(0)
    expect(store().playback.playing).toBe(true)
    expect(store().playback.state.counts.alerts).toBe(0)
    expect(store().playback.state.finalStats).toBeNull()
    store().togglePlay()
    expect(store().playback.playing).toBe(false)
  })
})
