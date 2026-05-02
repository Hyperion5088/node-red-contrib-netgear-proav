# Node-RED NETGEAR Pro AV

Node-RED nodes for monitoring and controlling NETGEAR Pro AV switches through the AVUI REST API.

This project is a Node-RED counterpart to the Home Assistant NETGEAR Pro AV integration:

- Home Assistant integration: `homeassistant-netgear-proav`
- Node-RED package: `node-red-contrib-netgear-proav`

## Nodes

`netgear-proav-switch` represents one physical switch. Put one node in the flow for each switch you want to automate.

Each node stores the switch host, port, TLS behaviour, timeout, credentials, and a default operation. The configured operation can be overridden with `msg.operation`, making the node useful in reusable flows.

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

The response from the switch is returned in `msg.payload`. The node also adds `msg.switch` with the configured switch name and host.

## Account Guidance

Create a dedicated switch user for automation. Avoid using the built-in `admin` account if NETGEAR Engage or browser management may also be used, because those sessions can interfere with API polling and controls.

## Local Development

From your Node-RED user directory, install this local package:

```bash
npm install "/Users/antony/Code/Node Red/node-red-contrib-netgear-proav"
```

Restart Node-RED after changing node files.

## Validation

```bash
npm run check
```

## Notes

This package uses the switch session-token API for normal AVUI calls and falls back to the legacy port `8443` endpoint for PoE operations where needed.

The code renews the session token before the 24-hour switch session limit by refreshing after 23 hours.
