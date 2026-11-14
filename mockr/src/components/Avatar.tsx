function hue(username: string): number {
  let h = 0;
  for (const ch of username) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map((w) => Array.from(w)[0] ?? '').join('').toUpperCase() || '?';
}

const SIZES = { sm: 'h-10 w-10 text-sm', md: 'h-12 w-12 text-base', lg: 'h-20 w-20 text-2xl' };

/** Colored circle with initials; color is derived from a hash of the username. */
export function Avatar({ name, username, size = 'sm' }: { name: string; username: string; size?: keyof typeof SIZES }) {
  return (
    <div
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white ${SIZES[size]}`}
      style={{ backgroundColor: `hsl(${hue(username)} 55% 45%)` }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
