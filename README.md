# Node-RED NETGEAR Pro AV

Node-RED nodes for monitoring and controlling NETGEAR Pro AV switches through the AVUI REST API.

This project is a Node-RED counterpart to the Home Assistant NETGEAR Pro AV integration:

- Home Assistant integration: `homeassistant-netgear-proav`
- Node-RED package: `node-red-contrib-netgear-proav`

## Nodes

`netgear-proav-switch` is a shared config node that represents one physical switch. It stores the switch host, port, TLS behaviour, timeout, credentials, and authenticated API session.

`netgear-proav-control` is the visible flow node. Add as many control nodes as you need and point them at the same switch config node. Each control node has a default operation, and that operation can still be overridden with `msg.operation`.

The editor separates actions into:

- `Get` commands for read-only API calls
- `Set` commands for state-changing control calls

For port actions, the editor loads the available port IDs from the selected switch config node. The dropdown stores the API-safe port ID and displays the switch-reported port name and description where available. Different NETGEAR models may report names as `x/x` or `x/x/x`; the editor preserves the switch-reported form in the label. `msg.portId` can still override the editor value at runtime, and may use either the numeric API ID or the same switch-reported label shown in the dropdown.

## Command Reference

The configured action can be overridden with `msg.operation`.

Common runtime inputs:

- `msg.portId` or `msg.payload.portId` targets port-specific operations. Use the numeric API ID or the visible switch label such as `7`, `0/7`, or `1/0/7`.
- `msg.config` or `msg.payload.config` can provide a current port configuration row for write operations, avoiding an extra read.

### Get Commands

| Operation | Description | Message inputs |
| --- | --- | --- |
| `deviceInfo` | Reads switch inventory, firmware, uptime, fans, CPU, memory, PoE capability, and system-level details. | None |
| `portConfig` | Reads full configuration for one port. | `msg.portId` or `msg.payload.portId` |
| `portConfigAll` | Reads full configuration for all physical ports. | None |
| `portSummary` | Reads and shapes port config, status, compact state, statistics, fibre optics, PoE, LLDP, STP, and multicast subscribers into `msg.payload.ports[portId]`. | None |
| `portsStatus` | Reads detailed per-port status rows including admin state, link state, media type, profile, description, STP, and physical speed. | None |
| `portStatus` | Reads compact per-port state and VLAN rows. | None |
| `portStatistics` | Reads port counters and bandwidth data. | `msg.statisticsType` or `msg.payload.statisticsType`, usually `errors`, `inbound`, or `outbound` |
| `fiberOptics` | Reads fibre/SFP inventory and live optical values where present. | None |
| `fiberOpticsDiag` | Reads raw diagnostic data for fibre/SFP ports. | None |
| `fiberOpticsEeprom` | Reads EEPROM/vendor data for fibre/SFP ports. | None |
| `stpConfig` | Reads switch-level Spanning Tree Protocol details including root bridge, priority, topology changes, and timers. | None |
| `stpPortInfo` | Reads per-port STP mode, edge status, forwarding state, and role. | None |
| `multicastGroups` | Reads multicast group/subscriber rows, sorted by port, VLAN, multicast group, subscriber, MAC, and type. The payload also includes grouped views in `msg.payload.multicastGroups.byPort`, `byVlan`, and `byGroup`. | Optional `msg.indexPage`, `msg.pageSize`, and `msg.unit`; defaults are `1`, `9999`, and `1` |
| `multicastMode` | Reads multicast mode for physical and LAG ports on models that populate this endpoint. Tested switches may return a successful but empty payload. | None |
| `dnsLookup` | Runs a DNS lookup from the switch. | `msg.domainName` or `msg.payload.domainName` |
| `pingTest` | Runs a ping from the switch. | `msg.ipAddr` or `msg.payload.ipAddr` |
| `traceTest` | Runs a traceroute from the switch. | `msg.ipAddr` or `msg.payload.ipAddr` |
| `cableTest` | Runs cable diagnostics against one or more physical ports. Cable diagnostics may briefly affect the tested ports. | `msg.ports` or `msg.payload.ports` as an array or comma-separated list |
| `imageInfo` | Reads firmware image information. | None |
| `neighbors` | Reads LLDP neighbor rows. | None |
| `profileList` | Reads configured/active AV profile definitions. | None |
| `poeInfo` | Reads switch-level PoE budget and consumption information. | None |
| `poePortConfig` | Reads PoE configuration for one port. | `msg.portId` or `msg.payload.portId` |
| `lagConfig` | Reads link aggregation group configuration. | None |
| `stacking` | Reads stack/member information where supported. | None |
| `vlanMembership` | Reads VLAN membership for one VLAN. | `msg.vlanId` or `msg.payload.vlanId` |

### Set Commands

| Operation | Description | Message inputs |
| --- | --- | --- |
| `setPortAdmin` | Enables or disables one port administratively. | `msg.portId`, plus `msg.enabled` or `msg.payload.enabled` |
| `setPortDescription` | Sets one port description. Uses the extended single-port endpoint first, then falls back to the older bulk endpoint. | `msg.portId`, plus `msg.description` or `msg.payload.description` |
| `setPoeEnabled` | Enables or disables PoE on one port. | `msg.portId`, plus `msg.enabled` or `msg.payload.enabled` |
| `resetPoe` | Power-cycles PoE on one port. | `msg.portId` |
| `setFanMode` | Sets switch fan mode. | `msg.fanMode` or `msg.payload.fanMode`; values are `1` Off, `2` Quiet, and `3` Cool |
| `saveConfig` | Saves the running switch configuration. | None |
| `reboot` | Reboots the switch. The switch may close the connection before returning a response. | `msg.save` or `msg.payload.save` controls whether the switch saves first; defaults to the editor checkbox |

Accepted boolean values for `msg.enabled` include `true`, `false`, `1`, `0`, `on`, and `off`.

Fan mode values:

- `1` = Off
- `2` = Quiet
- `3` = Cool

The response from the switch is returned in `msg.payload`. The control node also adds `msg.switch` with the configured switch name, host, and API port.

Port description writes use the extended single-port configuration endpoint first. This avoids the older bulk `swcfg_ports` endpoint on models that reject incomplete bulk payloads with an HTTP 500.

The `multicastGroups` operation preserves the switch rows in `msg.payload.multicastGroups.rows`, but sorts them into a stable order and also adds `byPort`, `byVlan`, and `byGroup` maps for easier flow logic.

The `portSummary` operation returns a shaped payload for flow/dashboard use. Port-specific data is merged into a sparse `ports` array where the array index matches the switch API port ID, so port 7 is available as `msg.payload.ports[7]`. Each populated port may include `config`, `status`, `state`, `statisticsErrors`, `statisticsInbound`, `statisticsOutbound`, `fiber`, `fiberDiagnostics`, `fiberEeprom`, `poe`, `neighbors`, `stp`, and `multicast` depending on what the switch returns. The `multicast` object includes `group_count`, `vlans`, `groups`, `subscribers`, and sorted `rows`.

## Account Guidance

Create a dedicated switch user for automation. Avoid using the built-in `admin` account if NETGEAR Engage or browser management may also be used, because those sessions can interfere with API polling and controls.

## Local Development

From your Node-RED user directory, install this local package:

```bash
npm install "/Users/antony/Code/Node Red/node-red-contrib-netgear-proav"
```

Restart Node-RED after changing node files. Create one `netgear-proav-switch` config node per switch, then add `netgear-proav-control` nodes for the read/control actions you want to run.

## Validation

```bash
npm run check
```

## Notes

This package uses the switch session-token API for normal AVUI calls and falls back to the legacy port `8443` endpoint for PoE operations where needed.

The code renews the session token before the 24-hour switch session limit by refreshing after 23 hours.
