import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '../lib/types';
import type { ValuesHandlers } from '../lib/api-client';

const events: ServerEvent[] = [
  { id: 1, timestamp: Date.now() - 60_000, severity: 'error', source: 'device', message: 'Device Incomer1 lost communication' },
  { id: 2, timestamp: Date.now() - 30_000, severity: 'warning', source: 'server', message: 'Reconnecting' },
  { id: 3, timestamp: Date.now(), severity: 'info', source: 'config', message: 'Project loaded' },
];

let handlers: ValuesHandlers | undefined;
const getEventsMock = vi.fn();

vi.mock('../lib/api-client', () => ({
  getEvents: (...args: unknown[]) => getEventsMock(...args),
  subscribeValues: (h: ValuesHandlers) => {
    handlers = h;
    return () => {};
  },
}));

import { ToastProvider } from '../lib/toast';
import { EventLogView } from './EventLogView';

function renderView() {
  return render(
    <ToastProvider>
      <EventLogView />
    </ToastProvider>,
  );
}

describe('EventLogView first-mount loading', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    handlers = undefined;
  });

  it('shows events after the initial snapshot resolves', async () => {
    getEventsMock.mockResolvedValue(events);
    renderView();
    expect(await screen.findByText('Device Incomer1 lost communication')).toBeTruthy();
  });

  it('shows events when the snapshot resolves slowly (delayed fetch)', async () => {
    getEventsMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(events), 200)),
    );
    renderView();
    // WS connects before the REST snapshot returns, like in the real app
    handlers?.onStateChange?.(true);
    handlers?.onEvent?.({ id: 4, timestamp: Date.now(), severity: 'info', source: 'server', message: 'streamed' });
    expect(await screen.findByText('Device Incomer1 lost communication')).toBeTruthy();
    expect(await screen.findByText('streamed')).toBeTruthy();
  });
});
