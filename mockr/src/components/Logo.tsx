/** Original mark: a bold rounded "R" in a violet circle. */
export function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#7c3aed" />
      <path
        d="M11 8.5h6.2c3.3 0 5.4 1.9 5.4 4.7 0 2.1-1.2 3.6-3.1 4.3l3.6 6h-3.9l-3.1-5.5h-1.8v5.5H11zm3.3 2.8v4h2.7c1.4 0 2.3-.8 2.3-2s-.9-2-2.3-2z"
        fill="#fff"
      />
    </svg>
  );
}
