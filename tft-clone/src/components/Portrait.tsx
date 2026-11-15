import { useState } from 'react';
import { Axe, BowArrow, Crosshair, Mountain, Shield, Sparkles, Swords, Sun } from 'lucide-react';

/**
 * Champion icons are loaded at runtime from Riot's public Data Dragon CDN (not bundled),
 * under Riot's "Legal Jibber Jabber" fan-project policy. `portrait` is the Data Dragon key.
 * Pinned so every viewer sees the same art. Monsters and failed loads fall back to neutral glyphs.
 */
export const DATA_DRAGON_VERSION = '16.22.1';
export const championIconUrl = (key: string) => `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/img/champion/${encodeURIComponent(key)}.png`;

const glyphs: Record<string, typeof Shield> = {
  Garen: Shield, Darius: Axe, Yasuo: Swords, Jinx: Crosshair,
  Ahri: Sparkles, Ashe: BowArrow, Leona: Sun, Krug: Mountain,
};

export function Portrait({ name, portrait, className = '' }: { name: string; portrait?: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const Glyph = glyphs[portrait ?? name] ?? Shield;
  const showIcon = portrait && failed !== portrait;
  return <span className={`portrait ${className}`} data-unit={name} role="img" aria-label={name}>
    {showIcon
      ? <img className="unit-icon" src={championIconUrl(portrait)} alt="" draggable={false} loading="lazy" onError={() => setFailed(portrait)} />
      : <span className="unit-glyph" aria-hidden="true"><Glyph /><small>{name.slice(0, 2)}</small></span>}
  </span>;
}
