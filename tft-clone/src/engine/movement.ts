import type { BattleUnit, Position } from './types';
import { distance } from './targeting';

export const BOARD_SIZE = 5;
export const MOVEMENT_INTERVAL = 0.4;
const index = (p: Position) => p.y * BOARD_SIZE + p.x;

/** BFS finds an unoccupied first step toward a tile in attack range.
 * Positions are updated after every move, so later actors see earlier reservations.
 * North/east/south/west is the deterministic shortest-path tie break.
 */
export function nextMovement(unit: BattleUnit, target: BattleUnit, units: BattleUnit[]): Position | undefined {
  const occupied = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
  for (const other of units) if (other.alive && other.id !== unit.id) occupied[index(other.position)] = 1;
  const start = index(unit.position);
  const previous = new Int16Array(BOARD_SIZE * BOARD_SIZE).fill(-1);
  previous[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    const position = { x: cell % BOARD_SIZE, y: Math.floor(cell / BOARD_SIZE) };
    if (cell !== start && distance(position, target.position) <= unit.range) {
      let first = cell;
      while (previous[first] !== start) first = previous[first];
      return { x: first % BOARD_SIZE, y: Math.floor(first / BOARD_SIZE) };
    }
    const neighbors: number[] = [];
    if (position.y > 0) neighbors.push(cell - BOARD_SIZE);
    if (position.x < BOARD_SIZE - 1) neighbors.push(cell + 1);
    if (position.y < BOARD_SIZE - 1) neighbors.push(cell + BOARD_SIZE);
    if (position.x > 0) neighbors.push(cell - 1);
    for (const next of neighbors) {
      if (previous[next] !== -1 || occupied[next]) continue;
      previous[next] = cell;
      queue.push(next);
    }
  }
  return undefined;
}
