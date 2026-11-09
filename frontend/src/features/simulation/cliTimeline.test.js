import { beforeEach, describe, expect, it } from 'vitest'

import { session } from '../../playback/session.js'
import { useStore } from '../../state/store.js'
import { interruptedLines, isRunning, visibleLines } from './cliTimeline.js'

const entry = {
  input: 'ping APP-SRV',
  token: 7,
  animated: true,
  lines: ['Pinging 10.0.30.10 (simulated):', '', 'Reply from 10.0.30.10: bytes=32 time=4ms TTL=63', 'Reply from 10.0.30.10: bytes=32 time=4ms TTL=63', '', 'Packets: Sent = 2, Received = 2, Lost = 0 (0% loss)'],
  timeline: [0, 0, 4.48, 9.56, 9.56, 9.56],
}
const live = (time, over = {}) => ({ token: 7, time, finished: false, ...over })

describe('the terminal prints a line only when its packet has arrived', () => {
  it('prints the header at once and each reply only when the playhead reaches the time of its reply packet', () => {
    expect(visibleLines(entry, live(0))).toEqual(entry.lines.slice(0, 2))
    expect(visibleLines(entry, live(4.47))).toHaveLength(2)
    expect(visibleLines(entry, live(4.48))).toHaveLength(3)
    expect(visibleLines(entry, live(9.0))).toHaveLength(3) // the second reply has not reached the source yet
    expect(visibleLines(entry, live(9.56))).toEqual(entry.lines)
  })

  it('follows the playhead backwards when the run is scrubbed', () => {
    expect(visibleLines(entry, live(9.56))).toHaveLength(6)
    expect(visibleLines(entry, live(3))).toHaveLength(2)
  })

  it('shows everything for a finished run, for a run that is no longer loaded and for a command that was not animated', () => {
    expect(visibleLines(entry, live(1, { finished: true }))).toEqual(entry.lines)
    expect(visibleLines(entry, { token: 8, time: 0, finished: false })).toEqual(entry.lines)
    expect(visibleLines({ ...entry, animated: false }, live(0))).toEqual(entry.lines)
    expect(visibleLines({ ...entry, timeline: null }, live(0))).toEqual(entry.lines)
  })

  it('knows when a command is still being printed', () => {
    expect(isRunning(entry, live(2))).toBe(true)
    expect(isRunning(entry, live(2, { finished: true }))).toBe(false)
    expect(isRunning(entry, { token: 9, time: 2, finished: false })).toBe(false)
    expect(isRunning({ ...entry, frozen: ['^C'] }, live(2))).toBe(false)
  })

  it('freezes an interrupted ping at what was printed, adds ^C and the real statistics', () => {
    const lines = interruptedLines(entry, 5, { sent: 2, received: 1 })
    expect(lines.slice(0, 3)).toEqual(entry.lines.slice(0, 3))
    expect(lines).toContain('^C')
    expect(lines.join('\n')).toContain('Sent = 2, Received = 1, Lost = 1 (interrupted)')
    expect(lines.join('\n')).not.toContain('Packets: Sent = 2, Received = 2') // the original statistics never appear
    expect(interruptedLines({ ...entry, input: 'curl http://APP-SRV' }, 5, { sent: 0, received: 0 })).not.toContain('Packets: Sent = 0')
  })
})

describe('stopping a command', () => {
  beforeEach(() => {
    session.clear()
    useStore.setState({ cli: {}, cliLive: null })
  })

  it('cancelCli keeps what was printed, adds ^C, unloads the run and leaves no live command or counters', () => {
    const packets = {
      1: { pid: 1, proto: 'icmp', icmp: { type: 8, seq: 1 }, mirrorOf: null },
      2: { pid: 2, proto: 'icmp', icmp: { type: 0, seq: 1 }, mirrorOf: null },
      3: { pid: 3, proto: 'icmp', icmp: { type: 8, seq: 2 }, mirrorOf: null },
    }
    useStore.setState({
      cli: { 'PC-1': [entry] },
      cliLive: { node: 'PC-1', token: 7 },
      playback: { loaded: true, playing: true, speed: 1, time: 5, duration: 20, finished: false, state: { packets } },
    })
    useStore.getState().cancelCli()
    const state = useStore.getState()
    const printed = state.cli['PC-1'][0].frozen
    expect(printed.slice(0, 3)).toEqual(entry.lines.slice(0, 3))
    expect(printed).toContain('^C')
    expect(printed.join('\n')).toContain('Sent = 2, Received = 1, Lost = 1 (interrupted)')
    expect(state.cliLive).toBeNull()
    expect(state.playback).toMatchObject({ loaded: false, playing: false, time: 0, state: null })
    expect(session.player).toBeNull()
    expect(visibleLines(state.cli['PC-1'][0], { token: null, time: 0, finished: false })).toEqual(printed) // later playback cannot add lines
  })

  it('cancelling with nothing running changes nothing', () => {
    useStore.getState().cancelCli()
    expect(useStore.getState().cli).toEqual({})
  })
})
