import { useState } from 'react';
import { BowArrow, Mountain, Shield, Sword } from 'lucide-react';
import { DATA_DRAGON_VERSION } from './Portrait';

/**
 * Item icons load at runtime from Riot's Data Dragon CDN (not bundled), keyed by League item ID.
 * Kept out of items.json so the baseline config fingerprint, which binds saved results, is unchanged.
 */
const DATA_DRAGON_ITEMS: Record<string, string> = { bf_sword: '1038', recurve_bow: '1043', chain_vest: '1031' };
export const itemIconUrl = (id: string) => DATA_DRAGON_ITEMS[id] ? `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/img/item/${DATA_DRAGON_ITEMS[id]}.png` : null;

export function EquipmentIcon({ id, size = 16 }: { id: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = itemIconUrl(id);
  if (url && failed !== id) {
    return <img className="item-icon" src={url} width={size} height={size} alt="" aria-hidden="true" draggable={false} loading="lazy" onError={() => setFailed(id)} />;
  }
  const Icon = id === 'bf_sword' ? Sword : id === 'recurve_bow' ? BowArrow : id === 'krug' ? Mountain : Shield;
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}
