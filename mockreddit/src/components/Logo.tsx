/** Original mark: a speech bubble with a hex cut-out. */
export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M4 6a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H13l-6 5v-5H8a4 4 0 0 1-4-4z" fill="#0f9d8a" />
      <path d="M16 7.5l5 2.9v5.8l-5 2.9-5-2.9v-5.8z" fill="#fff" />
    </svg>
  );
}
