import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Names of the golden traces exported by scripts/export_golden_traces.py. */
export const TRACE_NAMES = ['s1-monitor', 's2-monitor', 's2-enforce', 's3-monitor', 's3-enforce']

/** Single-attempt traces that trigger the firewall and ACL effects (see the export script). */
export const EFFECT_TRACE_NAMES = ['fw-deny', 'acl-deny']

/** A complete engine run (`{events, summary, ...}`) used as a test fixture. */
export function loadTrace(name) {
  return JSON.parse(readFileSync(resolve(here, 'fixtures', `${name}.json`), 'utf-8'))
}
