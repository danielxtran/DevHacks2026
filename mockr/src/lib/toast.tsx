import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const ToastContext = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** Minimal bottom-of-screen toast (used for like/repost failures). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div role="alert" className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-accent px-4 py-2 text-sm text-white shadow-lg sm:bottom-6">
          {msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}
