import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const STORAGE_KEY = 'odiserver-theme';

interface ThemeContextValue {
  /** Resolved theme actually applied to the document. */
  theme: Theme;
  /** User preference; 'system' follows prefers-color-scheme. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readPreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<Theme>(() =>
    preference === 'system' ? systemTheme() : preference,
  );

  useEffect(() => {
    if (preference !== 'system') {
      setResolved(preference);
      return;
    }
    setResolved(systemTheme());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(systemTheme());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: resolved,
      preference,
      setPreference: (p) => {
        window.localStorage.setItem(STORAGE_KEY, p);
        setPreferenceState(p);
      },
      toggle: () => {
        const next: Theme = resolved === 'dark' ? 'light' : 'dark';
        window.localStorage.setItem(STORAGE_KEY, next);
        setPreferenceState(next);
      },
    }),
    [resolved, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
