// Keep the replay/simulation implementation identity aligned between the API and Vite renderer.
export const ENGINE_FILE_PATHS = [
  'src/engine/combat.ts', 'src/engine/damage.ts', 'src/engine/movement.ts', 'src/engine/targeting.ts',
  'src/simulation/batchSimulator.ts', 'src/simulation/matchups.ts', 'src/simulation/random.ts',
  'src/simulation/statistics.ts', 'src/config/validation.ts',
] as const;
