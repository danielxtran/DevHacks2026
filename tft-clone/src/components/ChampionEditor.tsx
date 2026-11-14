import { useState } from 'react';
import { SlidersHorizontal, RotateCcw, ArrowRight } from 'lucide-react';
import type { BalanceChange, GameConfig, Stat } from '../engine/types';
import { statLimits } from '../config/validation';
import { EquipmentIcon } from './EquipmentIcon';
import { Portrait } from './Portrait';
const labels:Record<Stat,string>={hp:'Health',attackDamage:'Attack damage',attackSpeed:'Attack speed',armor:'Armor',range:'Attack range'};
interface Props {baseline:GameConfig;config:GameConfig;changes:BalanceChange[];onChange:(change:BalanceChange)=>void;onReset:()=>void;error:string}
function StatInput({value,onChange,min,max,step,label,id}:{id:string;value:number;onChange:(n:number)=>void;min:number;max:number;step:number;label:string}){
 const [draft,setDraft]=useState(String(value));const [focused,setFocused]=useState(false);
 return <input id={id} aria-label={label} type="number" min={min} max={max} step={step} value={focused?draft:value} onFocus={()=>{setDraft(String(value));setFocused(true)}} onChange={e=>{setDraft(e.target.value);if(e.target.value.trim()!==''&&Number.isFinite(Number(e.target.value)))onChange(Number(e.target.value))}} onBlur={()=>{setFocused(false);setDraft(String(value))}}/>;
}
export function ChampionEditor({baseline,config,changes,onChange,onReset,error}:Props){
 const [kind,setKind]=useState<'unit'|'item'|'monster'>('unit'),[selected,setSelected]=useState('yasuo');
 const collection=kind==='unit'?config.champions:kind==='item'?config.items:config.monsters;
 const baseCollection=kind==='unit'?baseline.champions:kind==='item'?baseline.items:baseline.monsters;
 const id=Object.hasOwn(collection,selected)?selected:Object.keys(collection)[0];
 const entity=collection[id],base=baseCollection[id];
 const stats:Stat[]=kind==='item'?['attackDamage','attackSpeed','armor']:['hp','attackDamage','attackSpeed','armor','range'];
 const modified=changes.filter(c=>c.type===kind&&c.id===id);
 return <section className="panel editor-panel" id="editor" aria-labelledby="editor-title"><div className="panel-heading"><div><h2 id="editor-title"><SlidersHorizontal size={17}/>Patch workbench</h2></div><div className="editor-heading-actions"><span className="change-count" aria-live="polite">{changes.length} edit{changes.length===1?'':'s'}</span><button className="button icon-button reset-button" disabled={!changes.length} onClick={onReset} aria-label="Reset all edits" title="Reset all edits"><RotateCcw size={14}/></button></div></div>
 <div className="segmented" aria-label="Configuration type">{(['unit','item','monster'] as const).map(k=><button key={k} aria-pressed={kind===k} className={kind===k?'active':''} onClick={()=>setKind(k)}>{k==='unit'?'Champions':k==='item'?'Items':'Krug'}</button>)}</div>
 <div className={`champion-roster ${kind!=='unit'?'item-roster':''}`}>{Object.entries(collection).map(([key,c])=><button className={`roster-choice ${id===key?'active':''}`} key={key} aria-pressed={id===key} onClick={()=>setSelected(key)} aria-label={`Edit ${c.name}`} title={c.name}>{kind==='unit'?<Portrait name={c.name} portrait={config.champions[key].portrait}/>:<span className="equipment-icon"><EquipmentIcon id={key} size={24}/></span>}<span>{kind==='unit'?c.name:c.name}</span>{changes.some(e=>e.id===key&&e.type===kind)&&<i className="changed-dot"/>}</button>)}</div>
 <div className="editor-selected"><div className="editor-identity">{kind==='unit'?<Portrait name={entity.name} portrait={config.champions[id].portrait}/>:<span className="large-item-symbol"><EquipmentIcon id={id} size={26}/></span>}<div><h3>{entity.name}</h3><span>{kind==='unit'?config.champions[id].role:kind==='monster'?'PvE encounter':'One item per unit'}</span></div></div><span className={`status-tag ${modified.length?'edited':''}`}>{modified.length?'Modified':'Baseline'}</span></div>
 <div className="stat-column-heading"><span>Combat stat</span><span>Baseline</span><span>Proposed</span></div>
 <div className="stat-edit-list">{stats.map(stat=>{const now=(entity as unknown as Record<string,number>)[stat],original=(base as unknown as Record<string,number>)[stat];const range=statLimits[stat];return <div className={`stat-edit-row ${now!==original?'modified':''}`} key={`${kind}-${id}-${stat}`}><label htmlFor={`${kind}-${id}-${stat}`}>{labels[stat]}{kind==='item'?<small>bonus{stat==='attackSpeed'?' · attacks / s':''}</small>:stat==='attackSpeed'?<small>attacks / s</small>:stat==='range'?<small>tiles</small>:null}</label><span className="baseline-stat">{original}</span><div className="stat-input-wrap"><ArrowRight size={12}/><StatInput id={`${kind}-${id}-${stat}`} label={`${entity.name} ${labels[stat]}`} value={now} min={kind==='item'?0:range.min} max={range.max} step={stat==='attackSpeed'?0.1:1} onChange={value=>onChange({type:kind,id,stat,value})}/></div></div>})}</div>
 {error&&<p className="inline-error" role="alert">{error}</p>}
 <div className="editor-note"><span className="edit-dot"/>Session edits · The baseline stays fixed.</div>
 </section>
}
