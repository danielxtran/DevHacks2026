import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackIcon } from './Icons';

/** Sticky page header for the center column. */
export function PageHeader({ title, subtitle, back = false, children }: { title: string; subtitle?: string; back?: boolean; children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="sticky top-0 z-20 border-b border-slate-100 bg-white/85 backdrop-blur">
      <div className="flex h-14 items-center gap-6 px-4">
        {back && (
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            aria-label="Back"
            className="-ml-2 rounded-full p-2 hover:bg-slate-100"
          >
            <BackIcon />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <span className="break-words">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 rounded border border-red-300 px-2 py-0.5 font-medium hover:bg-red-100">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-8 py-12 text-center">
      <p className="break-words text-2xl font-extrabold">{title}</p>
      {children && <div className="mt-2 text-slate-500">{children}</div>}
    </div>
  );
}
