# ODIServer Architecture

## Overview

ODIServer is an open-source industrial connectivity server with KEPServerEX parity. Node-RED runs **embedded** as the protocol-driver execution engine; a custom TypeScript wrapper provides the tag engine, configuration model, northbound servers, REST/WebSocket API, and web configuration console.

```
┌────────────────────────── ODIServer process ──────────────────────────┐
│  Web Config Console (React) ──► REST + WebSocket API (Express)        │
│                                │                                      │
│                     Configuration Store (SQLite)                      │
│                                │                                      │
│                        Tag Engine (in-memory)                         │
│                     scan groups · scaling · deadband                  │
│                     quality + timestamp · change events               │
│                       ▲                    │                          │
│         Driver Bridge │                    ▼                          │
│   (custom Node-RED nodes,      Northbound services                    │
│    runtime-generated flows)    ├─ OPC UA Server (node-opcua)          │
│                       ▲        └─ MQTT / Sparkplug B EoN              │
│        Embedded Node-RED runtime     (mqtt.js + sparkplug-payload)    │
│        ├─ Modbus TCP/RTU driver (node-red-contrib-modbus)             │
│        └─ OPC UA client driver (node-red-contrib-opcua client)        │
└────────────────────────────────────────────────────────────────────────┘
         │ Modbus TCP/RTU              │ OPC UA
         ▼                             ▼
     PLCs / devices              existing OPC UA servers
```

## Why Node-RED is embedded but not the tag engine

Node-RED excels at protocol I/O. But KEPServer's value is the **tag layer** — scan rates, scaling, deadband, quality/timestamps — and a fully controlled OPC UA address space. Those live natively in the wrapper:

- `node-opcua` runs natively for the northbound OPC UA server (full control of address space, security policies, PKI).
- The tag engine is in-memory TypeScript with an event bus; drivers push raw values in, northbound services consume change events.
- Flows are **generated programmatically** from the channel/device/tag configuration and deployed to the embedded runtime via its admin API.

## Configuration model (KEPServerEX mapping)

| KEPServerEX | ODIServer |
|---|---|
| Channel | Driver instance with comm settings (e.g. `modbus-1`) |
| Device | Device under a channel (unit ID, host, port) |
| Tag | Address binding + datatype + scan rate + scaling + deadband |
| OPC UA interface | Built-in node-opcua server, address space from tag tree |
| IoT Gateway / MQTT | Sparkplug B Edge-of-Network publisher |
| Configuration API | REST + WebSocket API |
| Config UI | Web configuration console |
| Datalogger, Advanced Tags, Scheduler | Roadmap addons (plugin API) |

## Packages

- `@odiserver/core` — config schema (zod), SQLite config store, in-memory tag engine, event bus
- `@odiserver/drivers` — custom Node-RED bridge nodes + flow generator (Modbus first)
- `@odiserver/northbound` — OPC UA server, MQTT/Sparkplug B EoN
- `@odiserver/api` — Express REST + WebSocket API
- `@odiserver/server` — composition root; embeds Node-RED, boots everything, serves web console
- `@odiserver/web` — React configuration console (OT tool design, light/dark)

## Data directory

Resolved per-OS; override with `ODISERVER_DATA_DIR`:

- Windows: `%PROGRAMDATA%\ODIServer`
- Linux: `/var/lib/odiserver`
- macOS: `~/Library/Application Support/ODIServer`
- Development fallback: `./data`

Contains `odiserver.db`, `nodered/` (flows, settings), `certs/` (OPC UA PKI).

## Phase roadmap

1. **Phase 0** — monorepo scaffold, core (config + tag engine), server skeleton, web console shell
2. **Phase 1** — Modbus end-to-end MVP (driver bridge, flow generator, REST/WS, simulator test)
3. **Phase 2** — OPC UA server northbound (address space, write-back, certs, security)
4. **Phase 3** — MQTT/Sparkplug B EoN (birth/death, aliases, DCMD write-back)
5. **Phase 4** — web console wired to live API (CRUD wizards, live monitor, event log)
6. **Phase 5** — OPC UA client driver
7. **Phase 6** — cross-platform packaging: systemd, Windows Service, launchd, multi-arch Docker, CI matrix
