import * as THREE from 'three'

import { MAX_PULSES } from './linkActivity.js'

/**
 * The cable material: a mid navy-blue tube with a cyan ridge of light along its top (so a cable reads against both the pale
 * platforms and the dark ground), a glow wash over the whole cable while a packet's route passes over it, and travelling pulses:
 * a bright head with a fading tail, in the packet's colour, moving in the packet's direction.
 *
 * One standard material per cable (so each can change on its own); all cables share one compiled program, because the shader code is
 * identical and only the per-material uniform values differ. The ridge needs the "up" direction in view space, which one shared
 * uniform carries and NetworkLinks updates once per frame.
 */

/** The view-space "up" vector, shared by every cable material. */
export const UP_VIEW = { value: new THREE.Vector3(0, 1, 0) }

const BASE = {
  ethernet: { color: '#1b4f8f', emissive: '#0b2447' },
  access: { color: '#1b4f8f', emissive: '#0b2447' },
  trunk: { color: '#1f5fa8', emissive: '#0d2c57' },
  mgmt: { color: '#3a6a93', emissive: '#12304a' },
}
const RIDGE = new THREE.Color('#38d6ff')

/**
 * @param {'ethernet'|'access'|'trunk'|'mgmt'} kind
 * @param {number} length  Length of the cable in world units (the pulse is a fixed physical size, not a fraction of the cable).
 */
export function makeCableMaterial(kind, length) {
  const base = BASE[kind] ?? BASE.ethernet
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(base.color),
    emissive: new THREE.Color(base.emissive),
    roughness: 0.38,
    metalness: 0.45,
    envMapIntensity: 0.9,
  })
  const uniforms = {
    uUp: UP_VIEW,
    uLen: { value: Math.max(length, 0.5) },
    uRidge: { value: RIDGE.clone().multiplyScalar(0.55) },
    uGlow: { value: 0 },
    uGlowColor: { value: new THREE.Color(0, 0, 0) },
    uPulse: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector3(0, 0, 0)) }, // x: position 0..1, y: direction, z: strength
    uPulseCol: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Color(0, 0, 0)) },
  }
  material.userData.cable = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vAlong;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = uv.x;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vAlong;
uniform vec3 uUp;
uniform float uLen;
uniform vec3 uRidge;
uniform float uGlow;
uniform vec3 uGlowColor;
uniform vec3 uPulse[${MAX_PULSES}];
uniform vec3 uPulseCol[${MAX_PULSES}];`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float up = clamp(dot(normalize(vNormal), normalize(uUp)), 0.0, 1.0);
  float ridge = pow(up, 7.0);
  vec3 add = uRidge * ridge * (0.55 + 1.6 * uGlow) + uGlowColor * uGlow * (0.45 + 0.9 * ridge);
  for (int i = 0; i < ${MAX_PULSES}; i++) {
    float s = uPulse[i].z;
    if (s > 0.001) {
      float dx = (uPulse[i].x - vAlong) * uLen;       // world distance from the head, positive behind a head moving towards B
      float behind = dx * uPulse[i].y;
      float head = exp(-abs(dx) * 1.5);
      float tail = behind > 0.0 ? exp(-behind * 0.3) * 0.7 : 0.0;
      add += uPulseCol[i] * (head * 2.6 + tail) * s * (0.8 + 0.7 * ridge);
    }
  }
  totalEmissiveRadiance += add;
}`,
      )
  }
  material.customProgramCacheKey = () => `cable-${MAX_PULSES}`
  return material
}

/** Colour as [r, g, b] in 0..1, from a CSS hex string. */
export function rgbOf(hex) {
  const c = new THREE.Color(hex)
  return /** @type {[number, number, number]} */ ([c.r, c.g, c.b])
}
