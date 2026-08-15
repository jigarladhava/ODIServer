/**
 * Mock water-treatment plant: Modbus TCP simulator + demo channel seed data.
 *
 * 1. Creates a "Demo_Water_Plant" channel/device/tags via the REST API of a
 *    running ODIServer (http://localhost:8080 by default).
 * 2. Serves those tags from a local Modbus TCP simulator on 127.0.0.1:15020
 *    with slowly drifting, realistic process values.
 *
 * Used to produce the screenshots in ./screenshots. Keep it running while
 * you run scripts/capture-screenshots.mjs.
 *
 * Usage: node scripts/mock-plant.mjs [baseUrl]
 */
import { createServer } from 'node:net';
import modbus from 'jsmodbus';

const BASE_URL = process.argv[2] ?? 'http://localhost:8080';
const MODBUS_PORT = 15020;
const CHANNEL_ID = 'demo-water-plant';
const DEVICE_ID = 'demo-water-plant.pumpstation-01';

// ---------------------------------------------------------------------------
// Modbus simulator: holding register N lives at byte offset N*2.
// ---------------------------------------------------------------------------
const holding = Buffer.alloc(80);
let tick = 0;

function updateRegisters() {
  tick += 1;
  const f = (reg, v) => holding.writeFloatBE(v, reg * 2);
  const u = (reg, v) => holding.writeUInt16BE(v, reg * 2);
  f(0, 4.2 + 0.3 * Math.sin(tick / 7)); // Pump1_Discharge_Pressure (bar)
  f(2, 120 + 15 * Math.sin(tick / 11)); // Pump1_Flow (m3/h)
  f(4, 62 + 3 * Math.sin(tick / 13)); // Pump1_Motor_Temp (degC)
  f(6, 2.1 + 0.4 * Math.sin(tick / 5)); // Pump1_Vibration (mm/s)
  f(8, 71 + 5 * Math.sin(tick / 17)); // Clear_Water_Tank_Level (%)
  f(10, 3.8 + 0.2 * Math.sin(tick / 9)); // Pump2_Discharge_Pressure (bar)
  f(12, 98 + 10 * Math.sin(tick / 12)); // Pump2_Flow (m3/h)
  u(14, 1); // Pump1_Status (1 = running)
  u(15, 0); // Pump2_Status (0 = stopped)
  u(16, Math.round(55 + 10 * Math.sin(tick / 15))); // Outlet_Valve_Position (%)
}
updateRegisters();
setInterval(updateRegisters, 1000);

// ---------------------------------------------------------------------------
// Seed channel -> device -> tags through the REST API (idempotent).
// ---------------------------------------------------------------------------
async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (/exist|duplicate|conflict/i.test(text) || res.status === 409) return; // already seeded
    throw new Error(`POST ${path} -> ${res.status}: ${text}`);
  }
}

async function seed() {
  await post('/api/channels', {
    id: CHANNEL_ID,
    name: 'Demo_Water_Plant',
    driver: 'modbus-tcp',
    enabled: true,
    settings: {},
  });
  await post('/api/devices', {
    id: DEVICE_ID,
    channelId: CHANNEL_ID,
    name: 'PumpStation_01',
    enabled: true,
    settings: { host: '127.0.0.1', port: MODBUS_PORT, unitId: 1 },
  });
  const tag = (id, name, address, dataType, extra = {}) =>
    post('/api/tags', { id, deviceId: DEVICE_ID, name, address, dataType, scanRateMs: 500, ...extra });
  await tag('demo-p1-pressure', 'Pump1_Discharge_Pressure', '40001', 'float32');
  await tag('demo-p1-flow', 'Pump1_Flow', '40003', 'float32');
  await tag('demo-p1-temp', 'Pump1_Motor_Temp', '40005', 'float32');
  await tag('demo-p1-vibration', 'Pump1_Vibration', '40007', 'float32');
  await tag('demo-tank-level', 'Clear_Water_Tank_Level', '40009', 'float32');
  await tag('demo-p2-pressure', 'Pump2_Discharge_Pressure', '40011', 'float32');
  await tag('demo-p2-flow', 'Pump2_Flow', '40013', 'float32');
  await tag('demo-p1-status', 'Pump1_Status', '40015', 'uint16');
  await tag('demo-p2-status', 'Pump2_Status', '40016', 'uint16');
  await tag('demo-valve-position', 'Outlet_Valve_Position', '40017', 'uint16', {
    scaling: { enabled: true, rawMin: 0, rawMax: 100, engMin: 0, engMax: 100 },
  });
  console.log('[mock-plant] demo channel seeded');
}

await seed();

const sockets = new Set();
const server = createServer();
new modbus.server.TCP(server, { holding });
server.on('connection', (s) => {
  sockets.add(s);
  s.on('close', () => sockets.delete(s));
});
server.listen(MODBUS_PORT, '127.0.0.1', () =>
  console.log(`[mock-plant] Modbus simulator on 127.0.0.1:${MODBUS_PORT}`),
);
