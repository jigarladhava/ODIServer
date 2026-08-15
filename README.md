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

## Development

```bash
npm install
npm run dev        # boots ODIServer (API + embedded Node-RED + web console)
npm test           # unit tests
npm run typecheck  # type-check all packages
```

## License

Apache-2.0. See `LICENSE`.
