import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface DirtyGuardContextValue {
  /** True while any inspector editor has unsaved edits. */
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  /**
   * Call before a navigation that would discard edits. Returns true when it
   * is safe to proceed (nothing dirty, or the user confirmed the discard).
   */
  confirmDiscard: () => boolean;
}

const DirtyGuardContext = createContext<DirtyGuardContextValue | null>(null);

export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);

  // Warn on browser tab close / reload while edits are unsaved.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const confirmDiscard = useCallback(() => {
    if (!dirty) return true;
    return window.confirm('You have unsaved changes in the property inspector. Discard them?');
  }, [dirty]);

  const value = useMemo(() => ({ dirty, setDirty, confirmDiscard }), [dirty, confirmDiscard]);
  return <DirtyGuardContext.Provider value={value}>{children}</DirtyGuardContext.Provider>;
}

export function useDirtyGuard(): DirtyGuardContextValue {
  const ctx = useContext(DirtyGuardContext);
  if (!ctx) throw new Error('useDirtyGuard must be used within DirtyGuardProvider');
  return ctx;
}
