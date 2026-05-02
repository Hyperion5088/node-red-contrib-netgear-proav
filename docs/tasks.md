# NETGEAR Pro AV Node-RED Tasks

Public-safe working list for the Node-RED node package.

1. Add direct switch discovery or subnet scan helper nodes after the shared-connection model is validated.
2. Add PoE, LLDP, and VLAN-specific summary operations if the generic port summary is too broad for common flows.
3. Add optional protection helpers for critical ports before exposing easy toggle-style controls.
4. Add automated tests around request signing, session renewal, response parsing, and control payload generation.
5. Add screenshots and example flows before publishing to npm or flows.nodered.org.
6. Keep the Home Assistant NETGEAR Pro AV integration in sync with new Node-RED read surfaces after the Node-RED multicast output is validated. Diagnostics/tool entities for DNS, ping, traceroute, and cable test should be disabled by default. Card updates are parked for a later pass.

## Completed

- 2026-05-02: Validated the live port-ID dropdown against `NET-SWI-11`, `NET-SWI-12`, `NET-SWI-16`, `NET-SWI-21`, `NET-SWI-22`, and `NET-SWI-23`. All tested switches returned numeric API values with switch-reported `1/0/x` labels, and label-to-ID resolution worked.
- 2026-05-02: Added `portSummary`, which merges port-specific config, status, statistics, fiber, PoE, and LLDP data into `payload.ports[portId]` for easier Node-RED flow use.
- 2026-05-02: Expanded Node-RED editor help and README command reference so every Get and Set action documents its purpose and supported `msg.*` inputs.
- 2026-05-02: Added Node-RED commands for STP, multicast, DNS lookup, ping, traceroute, and cable test. Home Assistant was kept in sync for STP/multicast as interface attributes.
- 2026-05-02: Shaped multicast group output with sorted raw rows plus `byPort`, `byVlan`, and `byGroup` grouped views. `portSummary` now adds compact per-port multicast summaries.
- 2026-05-02: Verified `multicast_mode` returns successful but empty payloads on switches 11, 22, and 23. Kept the raw command for model compatibility, but removed it from `portSummary`.
