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

## Supported Operations

Read operations:

- `deviceInfo`
- `portConfig`
- `portConfigAll`
- `portsStatus`
- `portStatus`
- `portStatistics`
- `fiberOptics`
- `fiberOpticsDiag`
- `fiberOpticsEeprom`
- `imageInfo`
- `neighbors`
- `profileList`
- `poeInfo`
- `poePortConfig`
- `lagConfig`
- `stacking`
- `vlanMembership`

Control operations:

- `setPortAdmin`
- `setPortDescription`
- `setPoeEnabled`
- `resetPoe`
- `setFanMode`
- `saveConfig`
- `reboot`

## Message Inputs

Editor defaults can be overridden with message properties:

- `msg.operation`
- `msg.portId`
- `msg.enabled`
- `msg.description`
- `msg.fanMode`
- `msg.vlanId`
- `msg.statisticsType`
- `msg.config`

Fan mode values:

- `1` = Off
- `2` = Quiet
- `3` = Cool

The response from the switch is returned in `msg.payload`. The control node also adds `msg.switch` with the configured switch name, host, and API port.

Port description writes use the extended single-port configuration endpoint first. This avoids the older bulk `swcfg_ports` endpoint on models that reject incomplete bulk payloads with an HTTP 500.

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
