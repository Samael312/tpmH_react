"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";

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

  // Store the latest callback in a ref to avoid triggers on function identity changes
  const onRefreshRef = useRef(opts.onRefresh);
  onRefreshRef.current = opts.onRefresh;

  // Extract primitive dependencies
  const hasOnRefresh = Boolean(opts.onRefresh);
  const isFetching = Boolean(opts.isFetching);
  const title = opts.title;

  useEffect(() => {
    const handleRefresh = hasOnRefresh ? () => onRefreshRef.current?.() : null;

    setTopBar({
      title,
      onRefresh: handleRefresh,
      isFetching,
    });

    return () => setTopBar({ title: "", onRefresh: null, isFetching: false });
  }, [setTopBar, title, hasOnRefresh, isFetching]);
}