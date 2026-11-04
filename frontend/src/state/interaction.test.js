import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from './store.js'

const store = () => useStore.getState()

function reset() {
  store().clearEverything()
  store().closeInspector()
  store().hoverZone(null)
  store().hoverCable(null)
}

describe('zone selection is separate from device selection', () => {
  beforeEach(reset)

  it('selecting a zone leaves a selected device alone, and selecting a device leaves the zone alone', () => {
    store().select('PC-1')
    store().selectZone('staff')
    expect(store().selection.selectedId).toBe('PC-1')
    expect(store().zone.selectedId).toBe('staff')
    store().select('APP-SRV')
    expect(store().zone.selectedId).toBe('staff')
    store().select(null)
    expect(store().zone.selectedId).toBe('staff')
  })

  it('clearSelection (device, packet, cable) keeps the zone; clearEverything clears the zone too', () => {
    store().select('IDS-1')
    store().selectZone('soc')
    store().clearSelection()
    expect(store().selection.selectedId).toBeNull()
    expect(store().zone.selectedId).toBe('soc')
    store().select('IDS-1')
    store().clearEverything()
    expect(store().selection.selectedId).toBeNull()
    expect(store().zone.selectedId).toBeNull()
  })

  it('hovering a zone does not change the selected zone', () => {
    store().selectZone('admin')
    store().hoverZone('datacentre')
    expect(store().zone).toEqual({ selectedId: 'admin', hoveredId: 'datacentre' })
  })
})

describe('cable selection', () => {
  beforeEach(reset)

  it('a cable, a device and a packet exclude each other', () => {
    store().select('PC-1')
    store().selectCable('L07')
    expect(store().cable.selectedId).toBe('L07')
    expect(store().selection.selectedId).toBeNull()
    store().select('PC-2')
    expect(store().cable.selectedId).toBeNull()
    expect(store().selection.selectedId).toBe('PC-2')
    store().selectCable('L08')
    store().selectPacket(5)
    expect(store().cable.selectedId).toBeNull()
    expect(store().selection.packetId).toBe(5)
  })

  it('selecting a cable keeps the selected zone, and clearing the cable keeps a selected device untouched', () => {
    store().selectZone('staff')
    store().selectCable('L06')
    expect(store().zone.selectedId).toBe('staff')
    store().selectCable(null)
    expect(store().cable.selectedId).toBeNull()
    store().select('PC-1')
    store().selectCable(null)
    expect(store().selection.selectedId).toBe('PC-1')
  })
})

describe('device viewer state and camera requests', () => {
  beforeEach(reset)

  it('opening the viewer selects the device and closing it keeps the selection; it is open only while inspectorId is set', () => {
    expect(store().inspectorId).toBeNull()
    store().openInspector('DB-SRV')
    expect(store().inspectorId).toBe('DB-SRV')
    expect(store().selection.selectedId).toBe('DB-SRV')
    store().closeInspector()
    expect(store().inspectorId).toBeNull()
    expect(store().selection.selectedId).toBe('DB-SRV')
  })

  it('opening and closing the viewer does not create a camera request (the campus camera stays where it was)', () => {
    const before = store().cameraRequest
    store().openInspector('IPS-1')
    store().closeInspector()
    expect(store().cameraRequest).toBe(before)
  })

  it('a zone focus is a camera request of its own kind and drops the active preset', () => {
    store().requestPreset('overview')
    store().requestZoneFocus('datacentre')
    expect(store().cameraRequest).toMatchObject({ kind: 'zone', id: 'datacentre' })
    expect(store().activePreset).toBeNull()
    store().requestPreset('overview')
    expect(store().cameraRequest).toMatchObject({ kind: 'preset', id: 'overview' })
    expect(store().activePreset).toBe('overview')
  })
})
