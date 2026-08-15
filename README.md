# ODIServer

**O**pen **D**ata & **I**nterface Server — an open-source, cross-platform industrial connectivity server. A KEPServerEX alternative built on an embedded Node-RED driver engine with a native TypeScript tag engine, an OPC UA server, and northbound MQTT publishing.

## Features (roadmap)

- **Channel / Device / Tag** configuration model
- **Southbound drivers**: Modbus TCP/RTU, OPC UA client (S7, EtherNet/IP, BACnet planned)
- **Northbound**: OPC UA Server (node-opcua), MQTT publish agents (topic patterns, payload templates, timing modes, deadbands, per-tag overrides; Sparkplug B planned)
- **Tag engine**: scan groups, linear scaling, deadband, quality + timestamps
- **Web configuration console**: OT-style engineering tool UI (tree + grids + property inspector), light and dark themes
- **REST + WebSocket API** for integration
- **Cross-platform**: Windows, Linux (x64/ARM64, incl. Raspberry Pi), macOS, Docker

## Status

Early development. See `docs/architecture.md` for the design and phase roadmap.

## Screenshots

The web configuration console (demo data from `scripts/mock-plant.mjs`, a Modbus TCP simulator):

| | |
| --- | --- |
| ![Connectivity overview — channel/device/tag tree with property inspector](screenshots/connectivity-overview.png) | ![Tag grid with live values, quality and timestamps](screenshots/connectivity-tags.png) |
| *Connectivity overview: channel/device/tag tree, grids and property inspector* | *Tag grid: live values, quality badges and timestamps over WebSocket* |
| ![MQTT agent configuration](screenshots/mqtt-agent.png) | ![Diagnostics dashboard](screenshots/diagnostics.png) |
| *Northbound MQTT agent: topic patterns, payload formats, QoS, deadband, LWT* | *Diagnostics: server status, channel and device health at a glance* |
| ![Server settings](screenshots/settings.png) | ![Dark theme](screenshots/connectivity-tags-dark.png) |
| *Server settings: ports, data directory, theme* | *Dark theme* |

To regenerate: start the server (`npm run dev`), run `node scripts/mock-plant.mjs` in one terminal, then `node scripts/capture-screenshots.mjs` (requires `npm i --no-save puppeteer-core` and a local Chrome/Edge install).

## Development

```bash
npm install
npm run dev        # boots ODIServer (API + embedded Node-RED + web console)
npm test           # unit tests
npm run typecheck  # type-check all packages
```

## License

Apache-2.0. See `LICENSE`.
