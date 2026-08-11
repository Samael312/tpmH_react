"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

interface MobileTopBarState {
  title: string;
  onRefresh: (() => void) | null;
  isFetching: boolean;
}

interface MobileTopBarContextValue extends MobileTopBarState {
  setTopBar: (state: Partial<MobileTopBarState>) => void;
}

const MobileTopBarContext = createContext<MobileTopBarContextValue | null>(null);

export function MobileTopBarProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MobileTopBarState>({
    title: "",
    onRefresh: null,
    isFetching: false,
  });

  const setTopBar = useCallback((partial: Partial<MobileTopBarState>) => {
    setState(prev => ({ ...prev, ...partial }));
  }, []);

  return (
    <MobileTopBarContext.Provider value={{ ...state, setTopBar }}>
      {children}
    </MobileTopBarContext.Provider>
  );
}

export function useMobileTopBar() {
  const ctx = useContext(MobileTopBarContext);
  if (!ctx) throw new Error("useMobileTopBar debe usarse dentro de MobileTopBarProvider");
  return ctx;
}

/** Hook de conveniencia: cada página lo llama una vez para registrar su título/refresh */
export function usePageTopBar(opts: { title: string; onRefresh?: () => void; isFetching?: boolean }) {
  const { setTopBar } = useMobileTopBar();
  useEffect(() => {
    setTopBar({ title: opts.title, onRefresh: opts.onRefresh ?? null, isFetching: !!opts.isFetching });
    return () => setTopBar({ title: "", onRefresh: null, isFetching: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.title, opts.onRefresh, opts.isFetching]);
}