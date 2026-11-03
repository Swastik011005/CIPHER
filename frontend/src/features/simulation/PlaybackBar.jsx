import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import { useMemo } from 'react'

import { markersFor } from '../../playback/markers.js'
import { SPEEDS } from '../../playback/player.js'
import { session } from '../../playback/session.js'
import { useStore } from '../../state/store.js'
import { Segmented } from '../../ui/index.js'

const SPEED_OPTIONS = SPEEDS.map((s) => ({ value: s, label: `${s}×` }))

function Counter({ label, value, tone }) {
  return (
    <div className="pb-counter" data-tone={tone}>
      <span className="pb-counter__value mono">{value}</span>
      <span className="pb-counter__label">{label}</span>
    </div>
  )
}

/**
 * Transport controls for the loaded run: play/pause, step, restart, speed, a scrubber with
 * alert/block markers and the live counters. Everything shown comes from the trace player.
 */
export function PlaybackBar() {
  const playback = useStore((s) => s.playback)
  const togglePlay = useStore((s) => s.togglePlay)
  const setSpeed = useStore((s) => s.setSpeed)
  const seekTo = useStore((s) => s.seekTo)
  const stepEvent = useStore((s) => s.stepEvent)
  const restart = useStore((s) => s.restartPlayback)
  const { loaded, playing, speed, time, duration, finished, state } = playback

  const markers = useMemo(
    () => (loaded && session.player ? markersFor(session.player.events, duration) : []),
    // A re-run with a mid-run control keeps the run id but has new events, so key on the event list itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, duration, session.player?.events],
  )
  const counts = state?.counts

  return (
    <div className="playback glass" aria-label="Playback controls">
      <div className="playback__row">
        <button type="button" className="icon-btn" onClick={restart} disabled={!loaded} aria-label="Restart" title="Restart from T+0">
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--primary"
          onClick={togglePlay}
          disabled={!loaded}
          aria-label={playing ? 'Pause' : finished ? 'Replay' : 'Play'}
          title={playing ? 'Pause' : finished ? 'Replay' : 'Play'}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button type="button" className="icon-btn" onClick={stepEvent} disabled={!loaded} aria-label="Step to next event" title="Step to the next event">
          <SkipForward size={16} />
        </button>
        <Segmented label="Playback speed" value={speed} onChange={setSpeed} options={SPEED_OPTIONS} />

        <div className="scrubber">
          <div className="scrubber__marks" aria-hidden="true">
            {markers.map((m) => (
              <span key={m.key} className={`scrubber__mark scrubber__mark--${m.kind}`} style={{ left: `${m.left}%` }} title={m.title} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={loaded ? duration : 1}
            step={0.01}
            value={loaded ? time : 0}
            disabled={!loaded}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Timeline"
            aria-valuetext={loaded ? `T plus ${time.toFixed(1)} of ${duration.toFixed(1)} seconds` : 'No run loaded'}
          />
        </div>
        <span className="playback__clock mono">
          {loaded ? `${time.toFixed(1)} / ${duration.toFixed(1)} s` : 'no run'}
        </span>
      </div>

      {counts && (
        <div className="playback__counters">
          <Counter label="Packets" value={counts.data_packets} />
          <Counter label="Clean" value={counts.delivered_clean} tone="ok" />
          <Counter label="Flagged" value={counts.delivered_flagged} tone="warn" />
          <Counter label="Blocked" value={counts.blocked} tone="danger" />
          <Counter label="Alerts" value={counts.alerts} tone="sensor" />
          <Counter label="Incidents" value={counts.incidents} tone="sensor" />
        </div>
      )}
    </div>
  )
}
