# NETGEAR Pro AV Node-RED Repo Agent

Use this file as the starting brief for maintaining this repository with Codex or another coding agent.

## Mission

Maintain `@hyperion5088/node-red-contrib-netgear-proav`, a reusable Node-RED package for monitoring and controlling NETGEAR Pro AV switches through the AVUI REST API.

The public package should stay reusable and free of private deployment details. Local environment notes belong in ignored files under `private/`.

## First Context To Read

1. `README.md` for public package behavior and command documentation.
2. `package.json` for package metadata and available scripts.
3. `nodes/netgear-proav-switch.js` for runtime Node-RED behavior.
4. `nodes/netgear-proav-switch.html` for editor UI and help text.
5. `lib/client.js` for NETGEAR API calls, session handling, and response shaping.
6. `private/handover-node-red-dev.md` if it exists locally. This file is ignored and may contain private workspace context.

## Design Rules

- Keep one config node responsible for one switch connection and authenticated session.
- Let visible control nodes share the config node and accept editor defaults plus matching `msg.*` overrides.
- Preserve support for numeric port IDs and switch labels such as `0/7` and `1/0/7`.
- Prefer reading available port IDs and labels from the switch API rather than making users guess numeric IDs.
- Renew sessions before expiry and recover cleanly from login, reboot, or token expiry cases.
- Document every user-facing operation and every supported runtime input in both README command tables and Node-RED editor help.
- Keep output data shapes stable unless the change is intentional and documented.
- If Node-RED work discovers shared NETGEAR API behavior, check whether the companion Home Assistant integration needs matching updates.

## Safety Boundaries

- Do not commit credentials, hostnames, internal URLs, switch names, or deployment-specific notes.
- Do not move private handover content into public files without scrubbing local paths, hostnames, and operational details.
- Do not change DNS, reverse proxy, homepage, monitoring, or live deployment configuration unless the user explicitly asks for runtime deployment work.
- Treat set operations, reboot, PoE reset, cable tests, and future toggle helpers as potentially disruptive.

## Common Workflows

When adding or changing an operation:

1. Update the client API method or response shaping in `lib/client.js`.
2. Wire the operation in `nodes/netgear-proav-switch.js`.
3. Add or update editor controls in `nodes/netgear-proav-switch.html` when needed.
4. Update Node-RED help text in `nodes/netgear-proav-switch.html`.
5. Update the README command reference and runtime input documentation.
6. Add focused tests when a test harness exists, especially for parsing, payload generation, session renewal, and error handling.

When changing output shapes:

1. Name the changed fields explicitly in the README.
2. Preserve raw switch rows where practical.
3. Add shaped views as additional fields instead of replacing raw data where compatibility matters.
4. Check companion Home Assistant data-shape expectations if the behavior is shared.

## Validation

Run from the repository root:

```bash
npm run check
npm pack --dry-run
```

Run `npm test` when tests exist or when a change adds a test harness.

Before publishing or installing into a live Node-RED palette, run all available validation scripts and inspect the package contents produced by `npm pack --dry-run`.

## Current Backlog Themes

- Add direct switch discovery or subnet scan helper nodes after the shared-connection model is validated.
- Add PoE, LLDP, and VLAN-specific summary operations if `portSummary` is too broad for common flows.
- Add protection helpers before exposing easy destructive or toggle-style controls.
- Add automated tests around request signing, session renewal, response parsing, and control payload generation.
- Add screenshots and example flows before publishing to npm or flows.nodered.org.
