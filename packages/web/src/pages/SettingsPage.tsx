import { useState, type FormEvent } from 'react';
import { useTheme, type ThemePreference } from '../lib/theme';

const inputClass =
  'h-7 w-full max-w-72 rounded-sm border border-border bg-inset px-2 text-[12px] text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-center gap-2 border-b border-border py-1.5">
      <label htmlFor={htmlFor} className="text-[12px] text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const { preference, setPreference } = useTheme();
  const [serverName, setServerName] = useState('ODIServer');
  const [opcUaPort, setOpcUaPort] = useState('49320');
  const [httpPort, setHttpPort] = useState('39320');
  const [saved, setSaved] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Stub: settings persistence arrives with the runtime API.
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-canvas p-3">
      <h1 className="mb-2 text-[13px] font-semibold">Settings</h1>
      <form
        onSubmit={onSubmit}
        className="max-w-2xl rounded-sm border border-border bg-panel px-3 py-1"
      >
        <Field label="Server Name" htmlFor="server-name">
          <input
            id="server-name"
            name="serverName"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="OPC UA Port" htmlFor="opcua-port">
          <input
            id="opcua-port"
            name="opcUaPort"
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            autoComplete="off"
            value={opcUaPort}
            onChange={(e) => setOpcUaPort(e.target.value)}
            className={`${inputClass} font-mono tabular-nums`}
          />
        </Field>
        <Field label="HTTP API Port" htmlFor="http-port">
          <input
            id="http-port"
            name="httpPort"
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            autoComplete="off"
            value={httpPort}
            onChange={(e) => setHttpPort(e.target.value)}
            className={`${inputClass} font-mono tabular-nums`}
          />
        </Field>
        <Field label="Data Directory" htmlFor="data-dir">
          <input
            id="data-dir"
            name="dataDir"
            type="text"
            readOnly
            value="C:/ProgramData/ODIServer/data"
            className={`${inputClass} font-mono text-muted`}
          />
        </Field>
        <Field label="Theme" htmlFor="theme">
          <select
            id="theme"
            name="theme"
            value={preference}
            onChange={(e) => setPreference(e.target.value as ThemePreference)}
            className="h-7 w-full max-w-72 rounded-sm border border-border bg-inset px-1.5 text-[12px] text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            <option value="system">System (follow OS)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>
        <div className="flex items-center gap-3 py-2.5 pl-[188px]">
          <button
            type="submit"
            className="h-7 rounded-sm border border-accent bg-accent px-3 text-[12px] font-medium text-accent-fg hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            Save Settings
          </button>
          <span aria-live="polite" className="text-[11px] text-good">
            {saved ? 'Settings saved (mock).' : ''}
          </span>
        </div>
      </form>
    </div>
  );
}
