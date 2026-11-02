import { Card, Chip, KpiTile } from '../../ui/index.js'

/**
 * Headline numbers of the loaded topology and the result of the backend validator.
 * @param {{topology: any}} props
 */
export function TopologySummary({ topology }) {
  const { summary, validation } = topology
  return (
    <Card
      eyebrow="Topology"
      title="Simulated campus"
      actions={
        validation.passed ? (
          <Chip tone="ok">
            {validation.check_count - validation.failed_count}/{validation.check_count} checks
          </Chip>
        ) : (
          <Chip tone="danger">{validation.failed_count} checks failed</Chip>
        )
      }
    >
      <div className="kpi-grid">
        <KpiTile label="Devices" value={summary.devices} hint={`+ ${summary.segments} Internet segment`} />
        <KpiTile label="Links" value={summary.links} />
        <KpiTile label="VLANs" value={summary.vlans} hint={topology.vlans.map((v) => v.id).join(' · ')} />
        <KpiTile label="IP subnets" value={summary.subnets} />
      </div>
    </Card>
  )
}
