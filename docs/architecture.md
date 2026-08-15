# ODIServer Architecture

## Overview

ODIServer is an open-source industrial connectivity server. Node-RED runs **embedded** as the protocol-driver execution engine; a custom TypeScript wrapper provides the tag engine, configuration model, northbound servers, REST/WebSocket API, and web configuration console.

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
│                       ▲        └─ MQTT publish agents (mqtt.js)       │
│        Embedded Node-RED runtime     topic patterns · payload         │
│        ├─ Modbus TCP/RTU driver (node-red-contrib-modbus)             │
│        └─ OPC UA client driver (node-red-contrib-opcua client)        │
└────────────────────────────────────────────────────────────────────────┘
         │ Modbus TCP/RTU              │ OPC UA
         ▼                             ▼
     PLCs / devices              existing OPC UA servers
```

## Why Node-RED is embedded but not the tag engine

Node-RED excels at protocol I/O. But a connectivity server's value is the **tag layer** — scan rates, scaling, deadband, quality/timestamps — and a fully controlled OPC UA address space. Those live natively in the wrapper:

- `node-opcua` runs natively for the northbound OPC UA server (full control of address space, security policies, PKI).
- The tag engine is in-memory TypeScript with an event bus; drivers push raw values in, northbound services consume change events.
- Flows are **generated programmatically** from the channel/device/tag configuration and deployed to the embedded runtime via its admin API.

## Configuration model

| Concept | ODIServer |
|---|---|
| Channel | Driver instance with comm settings (e.g. `modbus-1`) |
| Device | Device under a channel (unit ID, host, port) |
| Tag | Address binding + datatype + scan rate + scaling + deadband |
| MQTT agent | Northbound publisher: broker + auth/TLS, topic pattern, payload format, timing mode, deadband, QoS/retain, LWT; per-tag overrides/opt-out |
| OPC UA interface | Built-in node-opcua server, address space from tag tree |
| IoT Gateway / Sparkplug B | Roadmap: Sparkplug B Edge-of-Network publisher |
| Configuration API | REST + WebSocket API |
| Config UI | Web configuration console |
| Datalogger, Advanced Tags, Scheduler | Roadmap addons (plugin API) |

## Packages

- `@odiserver/core` — config schema (zod), SQLite config store, in-memory tag engine, event bus
- `@odiserver/drivers` — custom Node-RED bridge nodes + flow generator (Modbus first)
- `@odiserver/api` — Express REST + WebSocket API
- `@odiserver/server` — composition root; embeds Node-RED, boots everything, hosts the northbound OPC UA server and MQTT publish agents, serves web console
- `@odiserver/web` — React configuration console (OT tool design, light/dark)

## Data directory

Resolved per-OS; override with `ODISERVER_DATA_DIR`:

- Windows: `%PROGRAMDATA%\ODIServer`
- Linux: `/var/lib/odiserver`
- macOS: `~/Library/Application Support/ODIServer`
- Development fallback: `./data`

Contains `odiserver.db`, `nodered/` (flows, settings), `certs/` (OPC UA PKI).

## Importer plugins

Third-party project files (e.g. a KEPServerEX JSON export) are imported through
optional, folder-based plugins. Discovery is purely runtime: if the plugins
directory has no plugin folders, the UI offers only the native project format.

- **Location**: `<repo>/plugins/<plugin-id>/` (override with `ODISERVER_PLUGINS_DIR`).
- **Manifest**: `plugin.json` — `{ "id", "name", "main", "fileExtensions" }`.
- **Module**: `main` is a plain ESM JavaScript file (no build step) whose
  default export implements the `ImporterPlugin` contract from
  `@odiserver/api` (`importProject(raw) → { project, warnings }`, where
  `project` is any tree accepted by `parseProject`).
- **Loading**: `packages/server/src/plugins/loader.ts` scans the directory at
  boot; broken plugins are logged and skipped.
- **API**: `GET /api/plugins/importers` lists formats;
  `POST /api/project/import-plugin/:id?mode=replace|merge` converts + imports.
- **UI**: *Project → Open Project…* gains a "File format" select when at
  least one importer is installed; conversion warnings are shown after import.

Shipped plugin: `plugins/kepserver-import` — converts KEPServerEX JSON exports
(driver/data-type/word-order/zero-based-address mapping; per-device comm
timing, scan mode, block sizes and write-behavior settings; tag read/write
access and linear/square-root scaling with clamp/negate; skips unsupported
drivers like Ping with warnings; imports IoT Gateway MQTT clients as disabled
MQTT agents).


## Phase roadmap

1. **Phase 0** — monorepo scaffold, core (config + tag engine), server skeleton, web console shell
2. **Phase 1** — Modbus end-to-end MVP (driver bridge, flow generator, REST/WS, simulator test)
3. **Phase 2** — OPC UA server northbound (address space, write-back, certs, security)
4. **Phase 3** — MQTT publish agents (done: brokers, topic patterns, payload templates, timing modes, deadbands, per-tag overrides); Sparkplug B EoN profile next (birth/death, aliases, DCMD write-back)
5. **Phase 4** — web console wired to live API (CRUD wizards, live monitor, event log)
6. **Phase 5** — OPC UA client driver
7. **Phase 6** — cross-platform packaging: systemd, Windows Service, launchd, multi-arch Docker, CI matrix
