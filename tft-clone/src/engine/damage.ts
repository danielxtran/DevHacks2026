/** All attacks are physical; negative armor is clamped by the simplified rules. */
export function calculateDamage(rawDamage: number, armor: number): number {
  return rawDamage * 100 / (100 + Math.max(armor, 0));
}
