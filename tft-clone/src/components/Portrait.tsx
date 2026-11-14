import { Axe, BowArrow, Crosshair, Mountain, Shield, Sparkles, Swords, Sun } from 'lucide-react';

// Neutral unit markers keep the prototype independent of third-party artwork.
const glyphs: Record<string, typeof Shield> = {
  Garen: Shield, Darius: Axe, Yasuo: Swords, Jinx: Crosshair,
  Ahri: Sparkles, Ashe: BowArrow, Leona: Sun, Krug: Mountain,
};

export function Portrait({ name, portrait, className = '' }: { name: string; portrait?: string; className?: string }) {
  const Glyph = glyphs[portrait ?? name] ?? Shield;
  return <span className={`portrait ${className}`} data-unit={name} role="img" aria-label={name}>
    <span className="unit-glyph" aria-hidden="true"><Glyph /><small>{name.slice(0, 2)}</small></span>
  </span>;
}
