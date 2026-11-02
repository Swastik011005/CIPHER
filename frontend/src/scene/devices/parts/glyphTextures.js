import * as THREE from 'three'

/**
 * Procedural glyph tiles: small dark rounded tiles with a line icon, drawn on a canvas.
 * They give each device a recognisable top-face (or front-face) identifier without any image
 * files. One texture and material per glyph kind, shared by every device that uses it.
 */

const SIZE = 256
const STROKE = '#8fd0ff'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function arrow(ctx, x1, y1, x2, y2) {
  line(ctx, x1, y1, x2, y2)
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = 22
  for (const delta of [Math.PI * 0.82, -Math.PI * 0.82]) {
    line(ctx, x2, y2, x2 + head * Math.cos(angle + delta), y2 + head * Math.sin(angle + delta))
  }
}

function shieldPath(ctx, cx, top, w, h) {
  ctx.beginPath()
  ctx.moveTo(cx, top)
  ctx.lineTo(cx + w / 2, top + h * 0.16)
  ctx.lineTo(cx + w / 2, top + h * 0.52)
  ctx.quadraticCurveTo(cx + w / 2, top + h * 0.86, cx, top + h)
  ctx.quadraticCurveTo(cx - w / 2, top + h * 0.86, cx - w / 2, top + h * 0.52)
  ctx.lineTo(cx - w / 2, top + h * 0.16)
  ctx.closePath()
}

const DRAWERS = {
  monitor(ctx) {
    roundRect(ctx, 52, 66, 152, 100, 12)
    ctx.stroke()
    line(ctx, 128, 166, 128, 196)
    line(ctx, 96, 196, 160, 196)
  },
  laptop(ctx) {
    roundRect(ctx, 76, 64, 104, 84, 8)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(54, 170)
    ctx.lineTo(202, 170)
    ctx.lineTo(188, 192)
    ctx.lineTo(68, 192)
    ctx.closePath()
    ctx.stroke()
  },
  router(ctx) {
    ctx.beginPath()
    ctx.arc(128, 128, 38, 0, Math.PI * 2)
    ctx.stroke()
    arrow(ctx, 128, 84, 128, 40)
    arrow(ctx, 128, 172, 128, 216)
    arrow(ctx, 84, 128, 40, 128)
    arrow(ctx, 172, 128, 216, 128)
  },
  switch(ctx) {
    arrow(ctx, 48, 100, 208, 100)
    arrow(ctx, 208, 156, 48, 156)
  },
  'switch-l3'(ctx) {
    arrow(ctx, 48, 80, 208, 80)
    arrow(ctx, 208, 128, 48, 128)
    arrow(ctx, 48, 176, 208, 176)
  },
  shield(ctx) {
    shieldPath(ctx, 128, 40, 132, 176)
    ctx.stroke()
    line(ctx, 128, 74, 128, 190)
    line(ctx, 82, 112, 174, 112)
  },
  'shield-gate'(ctx) {
    shieldPath(ctx, 128, 40, 132, 176)
    ctx.stroke()
    line(ctx, 102, 100, 102, 168)
    line(ctx, 154, 100, 154, 168)
    arrow(ctx, 70, 134, 186, 134)
  },
  radar(ctx) {
    for (const r of [28, 56, 84]) {
      ctx.beginPath()
      ctx.arc(128, 128, r, Math.PI * 0.8, Math.PI * 2.2)
      ctx.stroke()
    }
    line(ctx, 128, 128, 192, 72)
    ctx.beginPath()
    ctx.arc(128, 128, 7, 0, Math.PI * 2)
    ctx.fill()
  },
  server(ctx) {
    for (const y of [54, 106, 158]) {
      roundRect(ctx, 56, y, 144, 42, 8)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(80, y + 21, 6, 0, Math.PI * 2)
      ctx.fill()
      line(ctx, 112, y + 21, 180, y + 21)
    }
  },
  database(ctx) {
    ctx.beginPath()
    ctx.ellipse(128, 70, 62, 22, 0, 0, Math.PI * 2)
    ctx.stroke()
    for (const y of [70, 118, 166]) {
      ctx.beginPath()
      ctx.ellipse(128, y + 24, 62, 22, 0, 0, Math.PI)
      ctx.stroke()
    }
    line(ctx, 66, 70, 66, 190)
    line(ctx, 190, 70, 190, 190)
  },
  log(ctx) {
    for (const [y, w] of [[70, 130], [108, 100], [146, 140], [184, 80]]) {
      ctx.beginPath()
      ctx.arc(66, y, 6, 0, Math.PI * 2)
      ctx.fill()
      line(ctx, 92, y, 92 + w, y)
    }
  },
  cloud(ctx) {
    ctx.beginPath()
    ctx.moveTo(84, 176)
    ctx.arc(84, 140, 36, Math.PI * 0.5, Math.PI * 1.5)
    ctx.arc(120, 100, 40, Math.PI, Math.PI * 1.9)
    ctx.arc(168, 124, 36, Math.PI * 1.4, Math.PI * 2.4)
    ctx.lineTo(168, 176)
    ctx.closePath()
    ctx.stroke()
  },
}

/** Glyph kinds that can be drawn. */
export const GLYPH_KINDS = Object.freeze(Object.keys(DRAWERS))

const textures = new Map()
const glyphMaterials = new Map()

/** @param {string} kind */
export function glyphTexture(kind) {
  if (textures.has(kind)) return textures.get(kind)
  const draw = DRAWERS[kind]
  if (!draw) throw new Error(`unknown glyph ${kind}`)

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  roundRect(ctx, 8, 8, SIZE - 16, SIZE - 16, 40)
  ctx.fillStyle = '#0d1a38'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(125, 175, 255, 0.55)'
  ctx.stroke()

  ctx.lineWidth = 14
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = STROKE
  ctx.fillStyle = STROKE
  draw(ctx)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  textures.set(kind, texture)
  return texture
}

/** Shared material for a glyph kind. */
export function glyphMaterial(kind) {
  if (!glyphMaterials.has(kind)) {
    glyphMaterials.set(
      kind,
      new THREE.MeshBasicMaterial({
        map: glyphTexture(kind),
        transparent: true,
        toneMapped: false,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    )
  }
  return glyphMaterials.get(kind)
}
