import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** The backend's authoritative topology file, read directly so the tests compare against the source. */
export function loadBackendTopology() {
  const path = resolve(here, '../../../backend/config/topology.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

/** The shared event contract. */
export function loadEventContract() {
  const path = resolve(here, '../../../contracts/events.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}
