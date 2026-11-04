import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DEVICE_SPECS } from '../devices/specs.js'
import { MODELS } from '../devices/models/index.js'
import { MODEL_NAMES, modelKeyOfNode, viewerFraming } from './modelInfo.js'

const topology = JSON.parse(readFileSync(new URL('../../../../backend/config/topology.json', import.meta.url), 'utf8'))

describe('device viewer models', () => {
  it('names and frames all 12 model keys, and every key has a campus model component to reuse', () => {
    const keys = Object.keys(DEVICE_SPECS).sort()
    expect(keys).toHaveLength(12)
    expect(Object.keys(MODEL_NAMES).sort()).toEqual(keys)
    expect(Object.keys(MODELS).sort()).toEqual(keys)
    for (const key of keys) {
      const f = viewerFraming(key)
      for (const v of [...f.center, f.radius, f.distance, f.minDistance, f.maxDistance, f.floorRadius]) expect(Number.isFinite(v), key).toBe(true)
      expect(f.minDistance, key).toBeLessThan(f.distance)
      expect(f.distance, key).toBeLessThan(f.maxDistance)
      expect(f.radius, key).toBeGreaterThan(0.3)
    }
  })

  it('the 17 topology nodes use all 12 model keys, each with a registered model', () => {
    const used = new Set(topology.nodes.map(modelKeyOfNode))
    expect([...used].sort()).toEqual(Object.keys(DEVICE_SPECS).sort())
    for (const node of topology.nodes) expect(MODELS[modelKeyOfNode(node)], node.id).toBeTypeOf('function')
  })
})
