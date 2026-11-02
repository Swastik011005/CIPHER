import { AccessSwitch } from './AccessSwitch.jsx'
import { CoreSwitch } from './CoreSwitch.jsx'
import { Desktop } from './Desktop.jsx'
import { Firewall } from './Firewall.jsx'
import { IdsSensor } from './IdsSensor.jsx'
import { InternetCloud } from './InternetCloud.jsx'
import { IpsGate } from './IpsGate.jsx'
import { Laptop } from './Laptop.jsx'
import { RackServer } from './RackServer.jsx'
import { RackSwitch } from './RackSwitch.jsx'
import { Router } from './Router.jsx'
import { SocConsole } from './SocConsole.jsx'

/** Model component for each device spec key (see devices/specs.js). */
export const MODELS = {
  desktop: Desktop,
  laptop: Laptop,
  router: Router,
  'switch-l3': CoreSwitch,
  'switch-l2': AccessSwitch,
  'switch-rack': RackSwitch,
  firewall: Firewall,
  'ids-sensor': IdsSensor,
  'ips-appliance': IpsGate,
  'rack-server': RackServer,
  'soc-console': SocConsole,
  'internet-cloud': InternetCloud,
}
