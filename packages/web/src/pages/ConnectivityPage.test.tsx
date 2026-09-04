import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../lib/types';

vi.mock('../lib/api-client', () => ({
  getMqttAgents: vi.fn().mockResolvedValue([]),
  updateEntity: vi.fn().mockResolvedValue({}),
  writeValue: vi.fn().mockResolvedValue(undefined),
}));

const project: Project = {
  channels: [
    {
      id: 'airport-booster-lt',
      name: 'airport-booster-lt',
      driver: 'opcua-client',
      enabled: true,
      settings: { endpointUrl: 'opc.tcp://localhost:49320' },
    },
  ],
  devices: [
    {
      id: 'airport-booster-lt.incomer2',
      channelId: 'airport-booster-lt',
      name: 'Incomer2',
      enabled: true,
      settings: {},
    },
  ],
  tags: ['pump1', 'pump2', 'pump3'].map((name) => ({
    id: `airport-booster-lt.incomer2.${name}`,
    deviceId: 'airport-booster-lt.incomer2',
    name,
    address: `ns=2;s=${name}`,
    dataType: 'float32' as const,
    access: 'rw' as const,
    scanRateMs: 1000,
    deadband: 0,
    scaling: {
      enabled: false,
      type: 'linear' as const,
      rawMin: 0,
      rawMax: 100,
      engMin: 0,
      engMax: 100,
      clampLow: false,
      clampHigh: false,
      negate: false,
    },
    description: '',
  })),
  mqttAgents: [],
};

vi.mock('../lib/project', () => ({
  useProject: () => ({ project, error: null, refresh: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../lib/live-values', () => ({
  useTagValues: () => ({ values: {}, trends: {}, connected: true, paused: false, setPaused: vi.fn() }),
}));

import { DirtyGuardProvider } from '../lib/dirty';
import { ConnectivityPage } from './ConnectivityPage';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DirtyGuardProvider>
        <Routes>
          <Route path="/" element={<ConnectivityPage />} />
        </Routes>
      </DirtyGuardProvider>
    </MemoryRouter>,
  );
}

describe('ConnectivityPage tag row selection', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows device tags and renders the tag inspector when a row is clicked', async () => {
    const user = userEvent.setup();
    renderAt('/?node=device%3Aairport-booster-lt.incomer2');

    // grid shows the device tags
    expect(await screen.findByText('pump1')).toBeTruthy();

    // click the pump1 row
    await user.click(screen.getByText('pump1'));

    // inspector at the bottom must show the tag editor for pump1
    expect(await screen.findByText('Tag — pump1')).toBeTruthy();
  });

  it('switches the inspector when clicking another tag row', async () => {
    const user = userEvent.setup();
    renderAt('/?node=device%3Aairport-booster-lt.incomer2');

    await user.click(await screen.findByText('pump1'));
    expect(await screen.findByText('Tag — pump1')).toBeTruthy();

    await user.click(screen.getByText('pump2'));
    expect(await screen.findByText('Tag — pump2')).toBeTruthy();
  });

  it('updates grid and tree highlight when selecting tree nodes', async () => {
    const user = userEvent.setup();
    renderAt('/?node=device%3Aairport-booster-lt.incomer2');

    const treeLabelOf = (label: string) =>
      screen.getAllByText(label).find((el) => el.closest('[role="treeitem"]')) as HTMLElement;
    const treeitemOf = (label: string) =>
      treeLabelOf(label).closest('[role="treeitem"]') as HTMLElement;

    // device selected: tags grid
    expect(await screen.findByRole('table', { name: 'Tags' })).toBeTruthy();
    expect(treeitemOf('Incomer2').getAttribute('aria-selected')).toBe('true');

    // select the channel: devices grid, highlight moves
    await user.click(treeLabelOf('airport-booster-lt'));
    expect(await screen.findByRole('table', { name: 'Devices' })).toBeTruthy();
    expect(treeitemOf('Incomer2').getAttribute('aria-selected')).toBe('false');

    // select the device again: tags grid comes back
    await user.click(treeLabelOf('Incomer2'));
    expect(await screen.findByRole('table', { name: 'Tags' })).toBeTruthy();
    expect(treeitemOf('Incomer2').getAttribute('aria-selected')).toBe('true');
  });
});
