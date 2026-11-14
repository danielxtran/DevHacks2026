/** Shared public contract. Stats are always read from GameConfig, never champion-specific logic. */
export type Stat = 'hp' | 'attackDamage' | 'attackSpeed' | 'armor' | 'range';
export interface Stats { hp:number; attackDamage:number; attackSpeed:number; armor:number; range:number }
export interface ChampionConfig extends Stats { name:string; role:string; portrait?:string }
export interface ItemConfig { name:string; attackDamage:number; attackSpeed:number; armor:number }
export interface GameConfig { id:string; champions:Record<string,ChampionConfig>; items:Record<string,ItemConfig>; monsters:Record<string,ChampionConfig> }
export interface Position { x:number; y:number }
export interface UnitSetup { id:string; championId:string; position:Position; itemId?:string }
export type Team = 'A' | 'B';
export interface BattleOptions { timestep?:number; maxDuration?:number; recordEvents?:boolean }
export interface BattleUnit extends Stats { id:string; championId:string; name:string; team:Team; position:Position; itemId?:string; maxHp:number; damageDealt:number; damageTaken:number; kills:number; survivalDuration:number; alive:boolean }
export type CombatEvent =
 | {type:'start'; time:number; units:BattleUnit[]}
 | {type:'move'; time:number; unitId:string; from:Position; to:Position}
 | {type:'attack'; time:number; unitId:string; targetId:string; damage:number; targetHp:number}
 | {type:'death'; time:number; unitId:string; killerId:string}
 | {type:'end'; time:number; winner:Team|'draw'};
export interface BattleResult {winner:Team|'draw';duration:number;units:BattleUnit[];survivors:BattleUnit[];events:CombatEvent[];seed:number}
export interface BalanceChange { type:'unit'|'item'|'monster'; id:string; stat:Stat; value:number }
export interface SimulationRequest {changes:BalanceChange[];simulations:number;seed:number;mode?:'pvp'|'pve'}
export interface PerformanceMetric {samples:number;wins:number;draws:number;winRate:number;confidenceInterval:[number,number];averageDamageDealt:number;averageDamageTaken:number;averageSurvivalDuration:number}
export interface BatchStatistics {games:number;draws:number;champions:Record<string,PerformanceMetric>;items:Record<string,PerformanceMetric>;compositions:Record<string,PerformanceMetric>;clearRate?:number}
export interface MetricDifference {winRate:number;averageDamageDealt:number;averageDamageTaken:number;averageSurvivalDuration:number}
export interface BalanceComparison {baselineConfigId:string;appliedChanges:BalanceChange[];simulations:number;seed:number;mode:'pvp'|'pve';before:BatchStatistics;after:BatchStatistics;differences:{champions:Record<string,MetricDifference>;items:Record<string,MetricDifference>;clearRate?:number};evaluationDurationMs:number;methodology:string}
export interface Matchup {teamA:UnitSetup[];teamB:UnitSetup[];seed:number}
