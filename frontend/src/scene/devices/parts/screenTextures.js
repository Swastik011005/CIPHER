import * as THREE from 'three'

/**
 * Procedural screen graphics for monitors and the security monitoring wall: a desktop with windows, a terminal, a dashboard of bar and
 * line charts, a world map with activity dots and an alert table. Drawn once on small canvases (no image files), one shared material
 * per kind. The graphics are static decoration: they show nothing about the simulation, only that a screen is on. Unlit and kept below
 * the bloom threshold so they never glow.
 */
const W = 256
const H = 160

const rect = (ctx, x, y, w, h, fill) => {
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
}

/** Deterministic pseudo-random numbers, so every build draws the same screens. */
function rng(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const DRAW = {
  desktop(ctx) {
    rect(ctx, 0, 0, W, H, '#16335f')
    rect(ctx, 0, H - 14, W, 14, '#0c1d3d')
    rect(ctx, 6, H - 10, 16, 6, '#5da2f0')
    rect(ctx, 20, 14, 130, 90, '#e8eefb')
    rect(ctx, 20, 14, 130, 12, '#3f7fd8')
    for (let i = 0; i < 6; i++) rect(ctx, 28, 34 + i * 11, 70 + ((i * 37) % 40), 5, '#9fb2d4')
    rect(ctx, 120, 60, 116, 72, '#cfdcf2')
    rect(ctx, 120, 60, 116, 10, '#2c9ec4')
    for (let i = 0; i < 4; i++) rect(ctx, 128, 78 + i * 12, 60 + ((i * 29) % 40), 5, '#7d93b9')
  },
  terminal(ctx) {
    rect(ctx, 0, 0, W, H, '#09152b')
    const r = rng(7)
    for (let i = 0; i < 11; i++) {
      rect(ctx, 8, 10 + i * 13, 24, 5, i % 4 === 0 ? '#58d6a8' : '#4aa8e8')
      rect(ctx, 38, 10 + i * 13, 40 + r() * 140, 5, '#7fb4e6')
    }
    rect(ctx, 8, 10 + 11 * 13, 8, 8, '#58d6a8')
  },
  dash(ctx) {
    rect(ctx, 0, 0, W, H, '#0a1a35')
    const r = rng(11)
    for (let i = 0; i < 3; i++) {
      rect(ctx, 8 + i * 82, 8, 74, 30, '#12305c')
      rect(ctx, 14 + i * 82, 14, 30, 6, '#7fb4e6')
      rect(ctx, 14 + i * 82, 25, 46, 9, i === 2 ? '#e0a84a' : '#58d6a8')
    }
    rect(ctx, 8, 46, 118, 100, '#0f2a52')
    for (let i = 0; i < 12; i++) {
      const h = 14 + r() * 70
      rect(ctx, 14 + i * 9, 138 - h, 6, h, '#3f8fe0')
    }
    rect(ctx, 134, 46, 114, 100, '#0f2a52')
    ctx.strokeStyle = '#58d6e6'
    ctx.lineWidth = 3
    ctx.beginPath()
    for (let i = 0; i <= 10; i++) {
      const x = 140 + i * 10
      const y = 120 - r() * 60
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  },
  map(ctx) {
    rect(ctx, 0, 0, W, H, '#0b1c3a')
    const land = '#2b5d9c'
    ctx.fillStyle = land
    for (const [x, y, rx, ry] of [[58, 60, 34, 22], [76, 104, 16, 24], [128, 56, 18, 14], [136, 96, 18, 26], [178, 60, 40, 24], [208, 108, 18, 12]]) {
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    const r = rng(5)
    for (let i = 0; i < 16; i++) rect(ctx, 20 + r() * 210, 30 + r() * 110, 4, 4, i % 5 === 0 ? '#e0a84a' : '#58d6e6')
    rect(ctx, 0, 0, W, 10, '#12305c')
  },
  alerts(ctx) {
    rect(ctx, 0, 0, W, H, '#0a1a35')
    rect(ctx, 0, 0, W, 14, '#12305c')
    const r = rng(3)
    const colours = ['#58d6a8', '#e0a84a', '#e05c6a', '#4aa8e8']
    for (let i = 0; i < 10; i++) {
      rect(ctx, 8, 22 + i * 13, 8, 8, colours[Math.floor(r() * 4)])
      rect(ctx, 24, 24 + i * 13, 60 + r() * 100, 5, '#6f93c9')
      rect(ctx, 200, 24 + i * 13, 40, 5, '#3f5f91')
    }
  },
}

export const SCREEN_KINDS = Object.freeze(Object.keys(DRAW))

const materials = new Map()

/** Shared unlit material for a screen kind. */
export function screenMaterial(kind) {
  if (!materials.has(kind)) {
    const draw = DRAW[kind]
    if (!draw) throw new Error(`unknown screen ${kind}`)
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    draw(canvas.getContext('2d'))
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 4
    materials.set(kind, new THREE.MeshBasicMaterial({ map, color: new THREE.Color(0.82, 0.82, 0.82), toneMapped: false }))
  }
  return materials.get(kind)
}
