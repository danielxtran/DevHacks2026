import { useEffect, useMemo, useState } from 'react';
import { Play, Pause, RotateCcw, Swords, Move, Trophy } from 'lucide-react';
import { simulateBattle } from '../engine/combat';
import type { BattleResult, BattleUnit, GameConfig, UnitSetup } from '../engine/types';
import { EquipmentIcon } from './EquipmentIcon';
import { Portrait } from './Portrait';
import { frameAt, startingUnits } from '../replay/frame';
interface Props {config:GameConfig;teamA:UnitSetup[];teamB:UnitSetup[];seed:number;mode:'pvp'|'pve';selectedUnit:string|null;onSelect:(id:string)=>void;onPlace:(x:number,y:number)=>void}
export function BattleBoard({config,teamA,teamB,seed,mode,selectedUnit,onSelect,onPlace}:Props) {
  const [result,setResult]=useState<BattleResult|null>(null),[playing,setPlaying]=useState(false),[time,setTime]=useState(0),[speed,setSpeed]=useState(1),[error,setError]=useState(''),[focusedTile,setFocusedTile]=useState(12);
  useEffect(()=>{setResult(null);setPlaying(false);setTime(0)},[config,teamA,teamB,mode,seed]);
  useEffect(()=>{if(!playing||!result)return;let last=performance.now();const handle=window.setInterval(()=>{const now=performance.now();const elapsed=(now-last)/1000*speed;last=now;setTime(t=>{const next=Math.min(result.duration,t+elapsed);if(next>=result.duration)setPlaying(false);return next})},32);return()=>clearInterval(handle)},[playing,result,speed]);
  const preview=useMemo(()=>{if(result)return startingUnits(result);return [...teamA.map(u=>({...u,team:'A' as const})),...teamB.map(u=>({...u,team:'B' as const}))].map(u=>{const stats=config.champions[u.championId]??config.monsters[u.championId];return {...stats,...u,maxHp:stats.hp,hp:stats.hp,alive:true,damageDealt:0,damageTaken:0,kills:0,survivalDuration:0} as BattleUnit})},[result,teamA,teamB,config]);
  const {units,attacks}=useMemo(()=>frameAt(preview,result,time),[preview,result,time]);
  const finished=!!result&&time>=result.duration;
  function battle(){try{setError('');const outcome=simulateBattle(teamA,teamB,config,seed);setResult(outcome);setTime(0);setPlaying(true)}catch(e){setError(e instanceof Error?e.message:'Unable to simulate this battle.')}}
  const replay=()=>{setTime(0);setPlaying(true)};
  return <section className="panel arena-panel" id="arena" aria-labelledby="arena-title">
    <div className="panel-heading"><div><h2 id="arena-title"><Swords size={18}/>Battle arena</h2><p className="panel-description">Exhibition battle · Your lineup, positions, and items</p></div><div className="mode-pill">{mode==='pvp'?'3 vs 3':'3 vs Krug'}</div></div>
    <div className="arena-status"><span><i className="team-dot blue"/>Team A</span><span className="battle-clock" aria-label={`Battle time ${time.toFixed(1)} seconds`}>{time.toFixed(1)}<small> / {result?.duration.toFixed(1)??'—'} s</small></span><span>{mode==='pvp'?'Team B':'Krug'}<i className="team-dot red"/></span></div>
    <div className={`board-shell ${selectedUnit&&!result?'placement-active':''}`}>
      <div className="battle-grid" role="group" aria-label="5 by 5 battle board" aria-description="Select a unit. Use arrow keys to focus a tile, then press Enter to place it. Press Escape to clear selection." onKeyDown={e=>{
        if(e.key==='Escape'&&selectedUnit){onSelect(selectedUnit);return;}
        const offsets:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-5,ArrowDown:5};
        if(!selectedUnit||result||!(e.key in offsets))return;
        const tile=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-tile]');
        if(!tile)return;
        e.preventDefault();
        const current=Number(tile.dataset.tile),next=current+offsets[e.key];
        if(next<0||next>24||(e.key==='ArrowLeft'&&current%5===0)||(e.key==='ArrowRight'&&current%5===4))return;
        setFocusedTile(next);
        e.currentTarget.querySelector<HTMLButtonElement>(`.board-cell[data-tile="${next}"]`)?.focus();
      }}>
        {Array.from({length:25},(_,i)=><button key={i} className={`board-cell row-${Math.floor(i/5)}`} data-tile={i} tabIndex={i===focusedTile?0:-1} onFocus={()=>setFocusedTile(i)} aria-label={`Place selected unit at column ${i%5+1}, row ${Math.floor(i/5)+1}`} onClick={()=>{if(!result)onPlace(i%5,Math.floor(i/5))}} disabled={!!result||!selectedUnit}/>) }
        <svg className="projectiles" viewBox="0 0 500 500" preserveAspectRatio="none" aria-hidden="true">{attacks.map((a,i)=><g key={i}><line x1={a.from.position.x*100+50} y1={a.from.position.y*100+50} x2={a.to.position.x*100+50} y2={a.to.position.y*100+50} stroke={a.from.team==='A'?'var(--team-a)':'var(--team-b)'} strokeWidth="4"/><circle cx={a.to.position.x*100+50} cy={a.to.position.y*100+50} r="27" fill="none" stroke="var(--text-primary)" strokeWidth="3"/><text x={a.to.position.x*100+50} y={a.to.position.y*100+15} fill="var(--text-primary)" fontSize="20" textAnchor="middle">−{Math.round(a.damage)}</text></g>)}</svg>
        {units.filter(u=>u.alive).map(u=><button key={u.id} className={`board-unit team-${u.team} ${selectedUnit===u.id?'selected':''} ${attacks.some(a=>a.from.id===u.id)?'attacking':''}`} data-tile={u.position.y*5+u.position.x} style={{left:`${u.position.x*20}%`,top:`${u.position.y*20}%`}} onClick={()=>!result&&config.champions[u.championId]&&onSelect(u.id)} aria-pressed={selectedUnit===u.id} aria-label={`${u.name}, Team ${u.team}, ${Math.ceil(u.hp)} health${u.itemId?`, ${config.items[u.itemId].name}`:''}`} disabled={!!result}>
          <span className="unit-portrait-wrap"><Portrait name={u.name} portrait={config.champions[u.championId]?.portrait}/>{u.itemId&&<span className="unit-item" title={config.items[u.itemId].name}><EquipmentIcon id={u.itemId} size={12}/></span>}</span><span className="unit-health"><span style={{width:`${Math.max(0,u.hp/u.maxHp*100)}%`}}/></span><span className="unit-name">{u.name}<small>{Math.ceil(u.hp)}</small></span>
        </button>)}
        {finished&&<div className="winner-banner" role="status"><Trophy size={25}/><strong>{result.winner==='draw'?'Battle drawn':mode==='pve'?(result.winner==='A'?'Krug defeated':'Krug holds the field'):`Team ${result.winner} wins`}</strong><span>{result.survivors.length} survivor{result.survivors.length===1?'':'s'} · {result.duration.toFixed(1)} seconds</span></div>}
      </div>
    </div>
    <div className="board-help"><Move size={14}/>{result?'Replay follows the simulator’s recorded movement and attacks.':selectedUnit?'Click an empty tile to move the selected unit.':'Select a unit, then click an empty tile to set its position.'}</div>
    <div className="replay-controls"><button className="button primary" onClick={result?replay:battle}>{result?<RotateCcw size={16}/>:<Play size={16}/>} {result?'Replay battle':'Start battle'}</button>{result&&<><button className="button icon-button" aria-label={playing?'Pause replay':'Resume replay'} onClick={()=>setPlaying(!playing)} disabled={finished}>{playing?<Pause size={16}/>:<Play size={16}/>}</button><button className="button subtle" onClick={()=>{setResult(null);setPlaying(false);setTime(0)}}>Edit board</button></>}<label className="speed-control">Playback<select aria-label="Playback speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label></div>
    {result&&<input className="timeline" type="range" min={0} max={result.duration} step={0.05} value={time} aria-label="Replay time" onChange={e=>{setPlaying(false);setTime(Number(e.target.value))}}/>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </section>
}
