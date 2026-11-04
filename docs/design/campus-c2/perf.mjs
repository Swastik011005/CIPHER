#!/usr/bin/env node
/**
 * The performance procedure for the C2 comparison: S4 Enforce at its peak, 1904 x 985, High and Low, twice each,
 * then the WebGL resources. It starts the app in demo mode itself and stops it afterwards.
 *
 *   node docs/design/campus-c2/perf.mjs <output folder> [port]
 *
 * Writes fps-<quality>-<n>.json (the output of scripts/measure_fps.mjs) and resources.json.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..', '..')
const out = resolve(process.argv[2] ?? join(here, 'perf'))
const port = Number(process.argv[3] ?? 8243)
mkdirSync(out, { recursive: true })
const base = `http://127.0.0.1:${port}`
const python = join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

const server = spawn(python, ['app.py'], { cwd: join(root, 'backend'), env: { ...process.env, NETSEC_PORT: String(port) }, stdio: 'ignore' })
const stop = () => (process.platform === 'win32' ? spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }) : server.kill())
try {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  const run = (script, args) => spawnSync('node', [script, ...args], { cwd: root, encoding: 'utf8', timeout: 300000 })
  for (const n of [1, 2]) {
    for (const quality of ['high', 'low']) {
      const r = run('scripts/measure_fps.mjs', ['--url', `${base}/simulation?debug=1`, '--scenario', 'S4', '--mode', 'enforce', '--start', '12', '--seconds', '10', '--quality', quality, '--width', '1904', '--height', '985', '--port', '9444'])
      writeFileSync(join(out, `fps-${quality}-${n}.json`), r.stdout)
      if (!r.stdout.trim()) throw new Error(`measure_fps printed nothing (exit ${r.status}): ${r.stderr.slice(-600)}`)
      const j = JSON.parse(r.stdout)
      console.log(`${quality} run ${n}: ${j.fps} fps (worst 1% frame ${j.worst1PercentFrameMs} ms), ${j.drawCalls} draw calls, ${j.triangles} triangles, pixel ratio ${j.pixelRatio}`)
    }
  }
  const r = run('docs/design/campus-c2/resources.mjs', [base])
  writeFileSync(join(out, 'resources.json'), r.stdout)
  const j = JSON.parse(r.stdout)
  for (const q of ['high', 'low']) console.log(`${q}: ${j[q].meshes} meshes, ${j[q].triangles} triangles, ${j[q].geometries} geometries, ${j[q].textures} textures, JS heap ${j[q].usedJSHeapMB} MB`)
  console.log(`transferred ${j.transferKB} KB in ${j.resources} requests`)
} finally {
  stop()
}
