#!/usr/bin/env node
/**
 * Renders campus-plan.svg to PNG with the repository's own Chrome driver.
 *
 *   node docs/design/campus-c1/render.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { openBrowser, sleep } from '../../../scripts/lib/cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const browser = await openBrowser({ width: 1500, height: 1000, port: 9890 })
try {
  const svg = readFileSync(join(here, 'campus-plan.svg'), 'utf8')
  const [, w, h] = svg.match(/<svg[^>]*\swidth="([\d.]+)" height="([\d.]+)"/).map(Math.ceil)
  await browser.setViewport(w, h)
  await browser.navigate(pathToFileURL(join(here, 'campus-plan.svg')).href)
  await sleep(400)
  await browser.screenshot(join(here, 'campus-plan.png'))
  console.log(`campus-plan.png  ${w} x ${h}`)
} finally {
  await browser.close()
}
