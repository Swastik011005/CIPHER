import { isRemoteApi } from '../api/client.js'

/**
 * What to do when the engine cannot be reached. A local engine has to be started by hand (`local` is that text); a
 * separately hosted one may only be asleep, and the page retries by itself.
 * @param {{local: import('react').ReactNode}} props
 */
export function EngineHint({ local }) {
  if (!isRemoteApi()) return <>{local}</>
  return <>The engine is hosted separately. If it was idle it may be waking up, which can take about a minute; this page keeps retrying.</>
}
