import { BowArrow, Mountain, Shield, Sword } from 'lucide-react';

export function EquipmentIcon({ id, size = 16 }: { id: string; size?: number }) {
  const Icon = id === 'bf_sword' ? Sword : id === 'recurve_bow' ? BowArrow : id === 'krug' ? Mountain : Shield;
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}
