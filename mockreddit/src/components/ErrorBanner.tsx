export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <span className="break-words">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 rounded border border-red-300 px-2 py-0.5 font-medium hover:bg-red-100">
          Retry
        </button>
      )}
    </div>
  );
}
