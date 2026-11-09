import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js'
import { useMemo } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'

import { protocolMix, topTalkers, trafficSeries } from '../../playback/charts.js'
import { Card } from '../../ui/index.js'

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip)

const COLOURS = { allowed: '#34D399', flagged: '#FBBF24', blocked: '#FF5A6A', tcp: '#4DA3FF', udp: '#38D6E6', icmp: '#A78BFA', text: '#A9B8D9', grid: 'rgba(140,170,255,0.10)' }

/** A vertical line at the playhead on the traffic chart. */
const playhead = {
  id: 'playhead',
  afterDatasetsDraw(chart, _args, options) {
    if (options?.index == null) return
    const x = chart.scales.x.getPixelForValue(options.index)
    const { top, bottom } = chart.chartArea
    const ctx = chart.ctx
    ctx.save()
    ctx.strokeStyle = '#EAF1FF'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
    ctx.restore()
  },
}

const axis = { ticks: { color: COLOURS.text, font: { size: 11 } }, grid: { color: COLOURS.grid }, border: { display: false } }
const base = { responsive: true, maintainAspectRatio: false, animation: { duration: 150 }, plugins: { legend: { labels: { color: COLOURS.text, boxWidth: 12 } }, tooltip: { enabled: true } } }

/**
 * The Monitoring page's three charts: traffic over time (stacked, by outcome, with the playhead), the protocol mix and the busiest
 * senders. Each point is a count of packets of the loaded trace, so the charts always agree with the counters above them.
 * @param {{state: any, duration: number, time: number, topology: any}} props
 */
export default function MonitoringCharts({ state, duration, time, topology }) {
  const series = useMemo(() => trafficSeries(state, duration, 1), [state, duration])
  const mix = useMemo(() => protocolMix(state), [state])
  const talkers = useMemo(() => topTalkers(state, topology, 6), [state, topology])
  const index = Math.min(series.labels.length - 1, Math.floor(time / series.bucket))

  const traffic = {
    labels: series.labels,
    datasets: [
      { label: 'Allowed', data: series.allowed, borderColor: COLOURS.allowed, backgroundColor: 'rgba(52,211,153,0.35)', fill: true, tension: 0.3, pointRadius: 0, stack: 's' },
      { label: 'Flagged', data: series.flagged, borderColor: COLOURS.flagged, backgroundColor: 'rgba(251,191,36,0.35)', fill: true, tension: 0.3, pointRadius: 0, stack: 's' },
      { label: 'Blocked', data: series.blocked, borderColor: COLOURS.blocked, backgroundColor: 'rgba(255,90,106,0.40)', fill: true, tension: 0.3, pointRadius: 0, stack: 's' },
    ],
  }
  const protocols = {
    labels: ['TCP', 'UDP', 'ICMP'],
    datasets: [{ data: [mix.tcp, mix.udp, mix.icmp], backgroundColor: [COLOURS.tcp, COLOURS.udp, COLOURS.icmp], borderColor: '#0C1A36', borderWidth: 2 }],
  }
  const senders = {
    labels: talkers.map((t) => t.name),
    datasets: [{ label: 'Packets sent', data: talkers.map((t) => t.packets), backgroundColor: COLOURS.tcp, borderRadius: 4 }],
  }
  const empty = talkers.length === 0

  return (
    <div className="grid grid--charts" aria-label="Charts of the run">
      <Card eyebrow="Traffic" title="Packets per second, by outcome">
        <div className="chart chart--wide" role="img" aria-label="Stacked area chart of packets per second: allowed, flagged and blocked, with the playhead">
          <Line
            data={traffic}
            plugins={[playhead]}
            options={{ ...base, interaction: { mode: 'index', intersect: false }, scales: { x: { ...axis, title: { display: true, text: 'Seconds of the run', color: COLOURS.text } }, y: { ...axis, stacked: true, beginAtZero: true, ticks: { ...axis.ticks, precision: 0 } } }, plugins: { ...base.plugins, playhead: { index } } }}
          />
        </div>
      </Card>
      <Card eyebrow="Protocols" title="Protocol mix">
        <div className="chart" role="img" aria-label="Doughnut chart of packets by protocol">
          {empty ? <p className="muted">No packets yet.</p> : <Doughnut data={protocols} options={{ ...base, cutout: '62%' }} />}
        </div>
      </Card>
      <Card eyebrow="Senders" title="Top talkers">
        <div className="chart" role="img" aria-label="Bar chart of the busiest senders">
          {empty ? <p className="muted">No packets yet.</p> : <Bar data={senders} options={{ ...base, indexAxis: 'y', plugins: { ...base.plugins, legend: { display: false } }, scales: { x: { ...axis, beginAtZero: true, ticks: { ...axis.ticks, precision: 0 } }, y: axis } }} />}
        </div>
      </Card>
    </div>
  )
}
