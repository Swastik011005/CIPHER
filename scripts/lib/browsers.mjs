/**
 * Where Chrome or Edge is installed, per platform. Set NETSEC_BROWSER_PATH to use a browser installed anywhere else.
 */
import { existsSync } from 'node:fs'

const CANDIDATES = {
  win32: {
    chrome: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
    edge: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
  },
  darwin: {
    chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  },
  linux: {
    chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
    edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
  },
}

/**
 * Paths to try for a browser, in order.
 * @param {string} browser  'chrome' or 'edge'
 * @param {string} [platform]
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function browserCandidates(browser, platform = process.platform, env = process.env) {
  const override = env.NETSEC_BROWSER_PATH ? [env.NETSEC_BROWSER_PATH] : []
  return [...override, ...(CANDIDATES[platform]?.[browser] ?? [])]
}

/** The first installed candidate, or undefined. */
export function findBrowser(browser = 'chrome', platform = process.platform, env = process.env) {
  return browserCandidates(browser, platform, env).find((p) => existsSync(p))
}
