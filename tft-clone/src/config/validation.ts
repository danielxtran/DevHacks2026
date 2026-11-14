import { z } from 'zod';
import type { BalanceChange, GameConfig, SimulationRequest, Stat } from '../engine/types';

export const statLimits:Record<Stat,{min:number;max:number;step:number}>={
 hp:{min:1,max:10000,step:1},attackDamage:{min:0,max:1000,step:1},attackSpeed:{min:0.1,max:5,step:0.1},armor:{min:0,max:500,step:1},range:{min:1,max:4,step:1}
};
const finite = (min:number,max:number)=>z.number().finite().min(min).max(max);
const stats={hp:finite(1,10000),attackDamage:finite(0,1000),attackSpeed:finite(0.1,5),armor:finite(0,500),range:finite(1,4).int()};
const unitSchema=z.object({name:z.string().min(1).max(80),role:z.string().min(1).max(40),portrait:z.string().regex(/^[A-Za-z0-9]+$/).optional(),...stats}).strict();
const itemSchema=z.object({name:z.string().min(1).max(80),attackDamage:finite(0,1000),attackSpeed:finite(0,5),armor:finite(0,500)}).strict();
const key=z.string().regex(/^[a-z][a-z0-9_]{0,49}$/).refine(s=>!['constructor','prototype','__proto__'].includes(s),'Reserved ID');
export const gameConfigSchema=z.object({id:z.string().min(1).max(100),champions:z.record(key,unitSchema).refine(v=>Object.keys(v).length>=3,'At least three champions required'),items:z.record(key,itemSchema),monsters:z.record(key,unitSchema).refine(v=>Object.hasOwn(v,'krug'),'Krug is required')}).strict();
export const changeSchema=z.object({type:z.enum(['unit','item','monster']),id:key,stat:z.enum(['hp','attackDamage','attackSpeed','armor','range']),value:z.number().finite()}).strict();
export const simulationRequestSchema=z.object({changes:z.array(changeSchema).max(100),simulations:z.union([z.literal(100),z.literal(1000),z.literal(5000),z.literal(10000)]),seed:z.number().int().min(0).max(4294967295),mode:z.enum(['pvp','pve']).optional()}).strict();
export function validateConfig(input:unknown):GameConfig { return gameConfigSchema.parse(input); }
export function applyPatch(config:GameConfig,changes:BalanceChange[]):GameConfig {
 const result=structuredClone(validateConfig(config));
 const parsed=z.array(changeSchema).max(100).parse(changes);
 for(const change of parsed){
  const group=change.type==='unit'?result.champions:change.type==='item'?result.items:result.monsters;
  if(!Object.hasOwn(group,change.id)) throw new Error(`Unknown ${change.type} ID: ${change.id}`);
  if(change.type==='item'&&!['attackDamage','attackSpeed','armor'].includes(change.stat)) throw new Error(`Item stat ${change.stat} is not permitted`);
  const limits=statLimits[change.stat];
  const minimum=change.type==='item'?0:limits.min;
  if(change.value<minimum||change.value>limits.max||(change.stat==='range'&&!Number.isInteger(change.value))) {
   throw new Error(`${change.type} ${change.id}.${change.stat} must be ${minimum}–${limits.max}${change.stat==='range'?' (integer)':''}`);
  }
  const entry=group[change.id];
  // Apply only explicitly permitted numeric stats; never interpret executable values or paths.
  (entry as unknown as Record<string,unknown>)[change.stat]=change.value;
 }
 return validateConfig(result);
}
export function validateSimulationRequest(input:unknown,config:GameConfig):SimulationRequest {
 const parsed=simulationRequestSchema.parse(input);
 applyPatch(config,parsed.changes);
 return parsed;
}
/** Content fingerprint changes whenever a baseline value changes. Not a security hash. */
export function configIdentifier(config:GameConfig):string {
 const canonical=(v:unknown):string=>v!==null&&typeof v==='object'&&!Array.isArray(v)?`{${Object.keys(v as object).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(v);
 let hash=2166136261;
 for(const c of canonical(config)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return `${config.id}-${(hash>>>0).toString(16).padStart(8,'0')}`;
}
