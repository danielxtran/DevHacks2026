import { describe, expect, it } from 'vitest';
import { simulateBattle, deriveUnitStats } from '../src/engine/combat';
import { calculateDamage } from '../src/engine/damage';
import { nearestEnemy } from '../src/engine/targeting';
import { baseConfig } from '../src/config';
import type { GameConfig, UnitSetup } from '../src/engine/types';

const fighter = (id: string, championId: string, x: number, y: number, itemId?: string): UnitSetup => ({id,championId,position:{x,y},itemId});
const duel = (config = baseConfig, options = {}) => simulateBattle([fighter('a','yasuo',1,2)],[fighter('b','garen',2,2)],config,42,options);
const cloneConfig = (): GameConfig => structuredClone(baseConfig);

describe('headless deterministic battle engine', () => {
  it('attacks remove health and attribute only actual damage taken', () => {
    const result = duel();
    expect(result.events.some(e => e.type === 'attack' && e.damage > 0)).toBe(true);
    expect(result.units.every(u => Math.abs(u.damageTaken - (u.maxHp - u.hp)) < 1e-7)).toBe(true);
    expect(result.units.reduce((s,u)=>s+u.damageDealt,0)).toBeCloseTo(result.units.reduce((s,u)=>s+u.damageTaken,0));
  });
  it('armor reduces physical damage using the requested formula', () => {
    expect(calculateDamage(40,0)).toBe(40);
    expect(calculateDamage(40,100)).toBe(20);
    expect(calculateDamage(40,-20)).toBe(40);
    const config = cloneConfig();
    config.champions.garen.armor = 100;
    const first = duel(config).events.find(e=>e.type==='attack'&&e.unitId==='a');
    expect(first?.type === 'attack' && first.damage).toBe(12.5);
  });
  it('higher attack speed increases attack frequency', () => {
    const config = cloneConfig();
    config.champions.yasuo.hp = 10000;
    config.champions.garen.hp = 10000;
    config.champions.yasuo.attackSpeed = 0.5;
    const slow = duel(config,{maxDuration:5});
    config.champions.yasuo.attackSpeed = 2;
    const fast = duel(config,{maxDuration:5});
    const attacks = (r: ReturnType<typeof duel>) => r.events.filter(e=>e.type==='attack'&&e.unitId==='a').length;
    expect(attacks(fast)).toBeGreaterThan(attacks(slow)*2);
  });
  it('all three items apply their configured additive stats', () => {
    const original = deriveUnitStats(fighter('a','yasuo',0,0),baseConfig);
    expect(deriveUnitStats(fighter('a','yasuo',0,0,'bf_sword'),baseConfig).attackDamage).toBe(original.attackDamage+15);
    expect(deriveUnitStats(fighter('a','yasuo',0,0,'recurve_bow'),baseConfig).attackSpeed).toBe(original.attackSpeed+0.3);
    expect(deriveUnitStats(fighter('a','yasuo',0,0,'chain_vest'),baseConfig).armor).toBe(original.armor+25);
    const withSword = simulateBattle([fighter('a','yasuo',1,2,'bf_sword')],[fighter('b','garen',2,2)],baseConfig,42);
    const attack = withSword.events.find(e=>e.type==='attack'&&e.unitId==='a');
    expect(attack?.type==='attack'&&attack.damage).toBeCloseTo(40*100/130);
  });
  it('moves toward out-of-range enemies without shared occupied tiles', () => {
    const result = simulateBattle([fighter('a','garen',0,0),fighter('c','leona',1,0)],[fighter('b','darius',4,4),fighter('d','yasuo',3,4)],baseConfig,5);
    const first = result.events.find(e=>e.type==='move');
    expect(first).toBeDefined();
    const initial = result.events[0];
    if (first?.type === 'move' && initial.type === 'start') {
      const actor = initial.units.find(u => u.id === first.unitId)!;
      const enemies = initial.units.filter(u => u.team !== actor.team);
      const nearestDistance = (p: {x:number;y:number}) => Math.min(...enemies.map(u => Math.abs(p.x-u.position.x)+Math.abs(p.y-u.position.y)));
      expect(nearestDistance(first.to)).toBeLessThan(nearestDistance(first.from));
    }
    const positions = new Map(result.events[0].type==='start'? result.events[0].units.map(u=>[u.id,u.position]):[]);
    for(const event of result.events){
      if(event.type==='move') positions.set(event.unitId,event.to);
      if(event.type==='death') positions.delete(event.unitId);
      expect(new Set([...positions.values()].map(p=>`${p.x},${p.y}`)).size).toBe(positions.size);
    }
    expect(result.events.some(e=>e.type==='attack')).toBe(true);
  });
  it('dead units never attack later and remaining units have correct survival times', () => {
    const result = duel();
    const dead = new Set<string>();
    for(const event of result.events){
      if(event.type==='death') dead.add(event.unitId);
      if(event.type==='attack') expect(dead.has(event.unitId)).toBe(false);
    }
    for(const survivor of result.survivors) expect(survivor.survivalDuration).toBe(result.duration);
    expect(result.units.some(u=>!u.alive)).toBe(true);
  });
  it('terminates with a winner and explicitly reports timeout draws', () => {
    expect(['A','B']).toContain(duel().winner);
    const config = cloneConfig();
    config.champions.yasuo.attackDamage=0;
    config.champions.garen.attackDamage=0;
    const result=duel(config,{maxDuration:1.25});
    expect(result.winner).toBe('draw');
    expect(result.duration).toBe(1.25);
    expect(result.events.at(-1)).toEqual({type:'end',time:1.25,winner:'draw'});
  });
  it('identical seeds and inputs produce identical events and metrics without mutating inputs', () => {
    const original = JSON.stringify(baseConfig);
    expect(duel()).toEqual(duel());
    expect(JSON.stringify(baseConfig)).toBe(original);
    const recorded=duel();
    const headless=duel(baseConfig,{recordEvents:false});
    expect(headless.events).toEqual([]);
    expect(headless.units).toEqual(recorded.units);
    expect(headless.winner).toBe(recorded.winner);
  });
  it('supports champion teams against a configured Krug', () => {
    const result=simulateBattle([fighter('a','garen',0,0),fighter('b','jinx',1,0),fighter('c','ahri',2,0)],[fighter('krug','krug',2,4)],baseConfig,7);
    expect(result.units.find(u=>u.championId==='krug')?.maxHp).toBe(300);
    expect(['A','B','draw']).toContain(result.winner);
    expect(result.duration).toBeLessThanOrEqual(60);
  });
  it('uses lexical ids to break equally distant target ties', () => {
    const config=cloneConfig();
    config.champions.yasuo.range=4;
    const result=simulateBattle([fighter('a','yasuo',2,2)],[fighter('z','garen',1,2),fighter('b','garen',3,2)],config,9,{maxDuration:0});
    const start=result.events[0];
    expect(start.type).toBe('start');
    if(start.type==='start') expect(nearestEnemy(start.units[0],start.units)?.id).toBe('b');
  });
  it('rejects collisions, invalid ids, invalid stats and out-of-board positions', () => {
    expect(()=>simulateBattle([fighter('a','garen',0,0)],[fighter('b','yasuo',0,0)],baseConfig,1)).toThrow(/share/);
    expect(()=>simulateBattle([fighter('a','missing',0,0)],[fighter('b','yasuo',1,0)],baseConfig,1)).toThrow(/Unknown/);
    expect(()=>simulateBattle([fighter('a','garen',-1,0)],[fighter('b','yasuo',1,0)],baseConfig,1)).toThrow(/board/);
    expect(()=>simulateBattle([fighter('a','garen',0,0)],[fighter('a','yasuo',1,0)],baseConfig,1)).toThrow(/unique/);
    const config=cloneConfig();config.champions.garen.attackSpeed=0;
    expect(()=>duel(config)).toThrow(/Invalid/);
    expect(()=>duel(baseConfig,{timestep:0})).toThrow(/Timestep/);
  });
});
