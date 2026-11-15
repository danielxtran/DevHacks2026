import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Film, Pause, Play, RotateCcw, Trophy } from 'lucide-react';
import { simulateBattle } from '../engine/combat';
import type { BattleResult, GameConfig, Matchup, UnitSetup } from '../engine/types';
import { replaySetup, type GameOutcome, type ReplayExperiment, type Winner } from '../replay/experiment';
import type { ScanResponse } from '../replay/scanWorker';
import { frameAt, startingUnits } from '../replay/frame';
import { EquipmentIcon } from './EquipmentIcon';
import { Portrait } from './Portrait';

const PAGE = 40;
const STAT_LABELS: Record<string, string> = { hp: 'Health', attackDamage: 'Attack damage', attackSpeed: 'Attack speed', armor: 'Armor', range: 'Range' };
type Filter = 'all' | 'changed';

function entityName(config: GameConfig, setup: UnitSetup) {
  return config.champions[setup.championId]?.name ?? config.monsters[setup.championId]?.name ?? setup.championId;
}
function teamNames(config: GameConfig, team: UnitSetup[]) {
  return team.map(u => entityName(config, u)).join(', ');
}
function winnerLabel(winner: Winner, matchup: Matchup, config: GameConfig) {
  if (winner === 'draw') return 'Draw';
  const team = winner === 'A' ? matchup.teamA : matchup.teamB;
  if (team.some(u => Object.hasOwn(config.monsters, u.championId))) return 'Krug';
  return `Team ${winner}`;
}

/** Read-only board for one recorded battle, driven by a shared clock. */
function ReplayBoard({ label, result, time, config, highlighted, matchup }: { label: string; result: BattleResult; time: number; config: GameConfig; highlighted: Set<string>; matchup: Matchup }) {
  const clock = Math.min(time, result.duration);
  const initial = useMemo(() => startingUnits(result), [result]);
  const { units, attacks } = useMemo(() => frameAt(initial, result, clock), [initial, result, clock]);
  const finished = time >= result.duration;
  return (
    <section className="panel replay-board" aria-label={`${label} replay`}>
      <div className="replay-board-heading">
        <h3>{label}</h3>
        <span className="battle-clock">{clock.toFixed(1)}<small> / {result.duration.toFixed(1)} s</small></span>
      </div>
      <div className="board-shell">
        <div className="battle-grid" aria-hidden="true">
          {Array.from({ length: 25 }, (_, i) => <div key={i} className={`board-cell row-${Math.floor(i / 5)}`} />)}
          <svg className="projectiles" viewBox="0 0 500 500" preserveAspectRatio="none">
            {attacks.map((a, i) => <g key={i}>
              <line x1={a.from.position.x * 100 + 50} y1={a.from.position.y * 100 + 50} x2={a.to.position.x * 100 + 50} y2={a.to.position.y * 100 + 50} stroke={a.from.team === 'A' ? 'var(--team-a)' : 'var(--team-b)'} strokeWidth="4" />
              <circle cx={a.to.position.x * 100 + 50} cy={a.to.position.y * 100 + 50} r="27" fill="none" stroke="var(--text-primary)" strokeWidth="3" />
              <text x={a.to.position.x * 100 + 50} y={a.to.position.y * 100 + 15} fill="var(--text-primary)" fontSize="20" textAnchor="middle">−{Math.round(a.damage)}</text>
            </g>)}
          </svg>
          {units.filter(u => u.alive).map(u => (
            <div key={u.id} className={`board-unit team-${u.team} ${attacks.some(a => a.from.id === u.id) ? 'attacking' : ''} ${highlighted.has(u.championId) || (u.itemId && highlighted.has(u.itemId)) ? 'patched-unit' : ''}`} style={{ left: `${u.position.x * 20}%`, top: `${u.position.y * 20}%` }}>
              <span className="unit-portrait-wrap"><Portrait name={u.name} portrait={config.champions[u.championId]?.portrait} />{u.itemId && <span className="unit-item" title={config.items[u.itemId]?.name}><EquipmentIcon id={u.itemId} size={12} /></span>}</span>
              <span className="unit-health"><span style={{ width: `${Math.max(0, u.hp / u.maxHp * 100)}%` }} /></span>
              <span className="unit-name">{u.name}<small>{Math.ceil(u.hp)}</small></span>
            </div>
          ))}
          {finished && <div className="winner-banner"><Trophy size={22} /><strong>{result.winner === 'draw' ? 'Draw' : `${winnerLabel(result.winner, matchup, config)} wins`}</strong><span>{result.survivors.length} survivor{result.survivors.length === 1 ? '' : 's'} · {result.duration.toFixed(1)} s</span></div>}
        </div>
      </div>
      <table className="replay-units">
        <caption className="sr-only">{label} final unit statistics</caption>
        <thead><tr><th scope="col">Unit</th><th scope="col">Damage dealt</th><th scope="col">Damage taken</th><th scope="col">Time alive</th></tr></thead>
        <tbody>{result.units.map(u => (
          <tr key={u.id} className={highlighted.has(u.championId) || (u.itemId && highlighted.has(u.itemId)) ? 'patched-row' : ''}>
            <th scope="row"><span className="replay-unit-name"><i className={`team-dot ${u.team === 'A' ? 'blue' : 'red'}`} />{u.name}{u.itemId && <small> · {config.items[u.itemId]?.name}</small>}</span></th>
            <td>{Math.round(u.damageDealt)}</td>
            <td>{Math.round(u.damageTaken)}</td>
            <td>{u.alive ? `${u.survivalDuration.toFixed(1)}s ✓` : `${u.survivalDuration.toFixed(1)}s`}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

export function ReplayViewer({ experiment, config, initialGame, initialFocus }: { experiment: ReplayExperiment; config: GameConfig; initialGame?: number; initialFocus?: string }) {
  const { request } = experiment;
  const setup = useMemo(() => replaySetup(experiment, config), [experiment, config]);
  const patchedIds = useMemo(() => new Set(request.changes.map(c => c.id)), [request.changes]);
  const [outcomes, setOutcomes] = useState<GameOutcome[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [scanError, setScanError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [focus, setFocus] = useState(initialFocus ?? '');
  const [page, setPage] = useState(0);
  const [game, setGame] = useState((initialGame ?? 1) - 1);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const worker = new Worker(new URL('../replay/scanWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ScanResponse>) => {
      if (event.data.type === 'progress') setScanned(event.data.done);
      if (event.data.type === 'result') { setOutcomes(event.data.outcomes); worker.terminate(); }
      if (event.data.type === 'error') { setScanError(event.data.error); worker.terminate(); }
    };
    worker.onerror = e => { setScanError(e.message || 'Replay scan failed.'); worker.terminate(); };
    worker.postMessage({ experiment, config });
    return () => worker.terminate();
  }, [experiment, config]);

  const visible = useMemo(() => setup.matchups.map((m, i) => i).filter(i => {
    const m = setup.matchups[i];
    if (focus && ![...m.teamA, ...m.teamB].some(u => u.championId === focus)) return false;
    if (filter === 'changed') return !!outcomes && outcomes[i].before !== outcomes[i].after;
    return true;
  }), [setup.matchups, focus, filter, outcomes]);

  const matchup = setup.matchups[game];
  const battles = useMemo(() => ({
    before: simulateBattle(matchup.teamA, matchup.teamB, setup.baseline, matchup.seed),
    after: simulateBattle(matchup.teamA, matchup.teamB, setup.patched, matchup.seed),
  }), [matchup, setup.baseline, setup.patched]);
  const duration = Math.max(battles.before.duration, battles.after.duration);

  useEffect(() => { setTime(0); setPlaying(true); }, [game]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const handle = window.setInterval(() => {
      const now = performance.now();
      const elapsed = (now - last) / 1000 * speed;
      last = now;
      setTime(t => { const next = Math.min(duration, t + elapsed); if (next >= duration) setPlaying(false); return next; });
    }, 32);
    return () => clearInterval(handle);
  }, [playing, speed, duration]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('game', String(game + 1));
    if (focus) url.searchParams.set('focus', focus); else url.searchParams.delete('focus');
    window.history.replaceState(null, '', url);
  }, [game, focus]);

  const position = visible.indexOf(game);
  // Filtering away the open game jumps to the first matching one.
  useEffect(() => { if (position === -1 && visible.length) setGame(visible[0]); }, [position, visible]);
  const step = (delta: number) => {
    if (!visible.length) return;
    const next = position === -1 ? visible[0] : visible[Math.min(visible.length - 1, Math.max(0, position + delta))];
    setGame(next);
    setPage(Math.floor(visible.indexOf(next) / PAGE));
  };
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const currentPage = Math.min(page, pages - 1);
  const changedCount = outcomes?.filter(o => o.before !== o.after).length;
  const finished = time >= duration;
  const exitUrl = `${window.location.pathname}`;

  return (
    <div className="replay-view">
      <div className="replay-header">
        <div>
          <a className="replay-back" href={exitUrl}><ArrowLeft size={14} />Balance lab</a>
          <h1><Film size={30} />Patch replays</h1>
          <p>Every game below is regenerated from this experiment's seed and replayed on the same engine the batch used. Baseline and patched sides play the identical matchup.</p>
        </div>
        <dl className="replay-facts">
          <div><dt>Patch</dt><dd>{request.changes.map(c => {
            const group = c.type === 'unit' ? config.champions : c.type === 'item' ? config.items : config.monsters;
            const entry = group[c.id] as unknown as Record<string, number | string>;
            return <span key={`${c.type}${c.id}${c.stat}`}>{String(entry?.name ?? c.id)} {STAT_LABELS[c.stat] ?? c.stat}: {entry?.[c.stat]} → {c.value}</span>;
          })}</dd></div>
          <div><dt>Games</dt><dd>{request.simulations.toLocaleString()} · {request.mode === 'pve' ? 'PvE' : 'PvP'}</dd></div>
          <div><dt>Seed</dt><dd>{request.seed}</dd></div>
          <div><dt>Baseline</dt><dd><code>{experiment.baselineConfigId}</code></dd></div>
        </dl>
      </div>

      <div className="replay-layout">
        <aside className="panel replay-list" aria-label="Games">
          <div className="replay-list-controls">
            <div className="segmented" aria-label="Filter games">
              <button className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); setPage(0); }}>All games</button>
              <button className={filter === 'changed' ? 'active' : ''} aria-pressed={filter === 'changed'} disabled={!outcomes} onClick={() => { setFilter('changed'); setPage(0); }}>
                Winner changed{changedCount !== undefined ? ` (${changedCount.toLocaleString()})` : ''}
              </button>
            </div>
            <label className="replay-focus">Champion
              <select value={focus} onChange={e => { setFocus(e.target.value); setPage(0); }}>
                <option value="">Any champion</option>
                {Object.entries(config.champions).map(([id, c]) => <option key={id} value={id}>{c.name}{patchedIds.has(id) ? ' (patched)' : ''}</option>)}
              </select>
            </label>
            {!outcomes && !scanError && <div className="replay-scan" role="status">
              <span>Scanning outcomes · {scanned.toLocaleString()} / {request.simulations.toLocaleString()}</span>
              <progress value={scanned} max={request.simulations} />
            </div>}
            {scanError && <p className="inline-error" role="alert">{scanError}</p>}
            <p className="replay-count">{visible.length.toLocaleString()} game{visible.length === 1 ? '' : 's'}</p>
          </div>
          <ol className="replay-games">
            {visible.slice(currentPage * PAGE, (currentPage + 1) * PAGE).map(i => {
              const m = setup.matchups[i];
              const o = outcomes?.[i];
              const changed = o && o.before !== o.after;
              return (
                <li key={i}>
                  <button className={`replay-game ${i === game ? 'active' : ''}`} aria-current={i === game} onClick={() => setGame(i)}>
                    <span className="replay-game-top"><strong>Game {i + 1}</strong>{o && <span className={changed ? 'replay-changed' : 'muted'}>{winnerLabel(o.before, m, config)}{changed ? ` → ${winnerLabel(o.after, m, config)}` : ''}</span>}</span>
                    <span className="replay-teams"><i className="team-dot blue" />{teamNames(config, m.teamA)}</span>
                    <span className="replay-teams"><i className="team-dot red" />{teamNames(config, m.teamB)}</span>
                  </button>
                </li>
              );
            })}
            {!visible.length && <li className="replay-empty">{filter === 'changed' ? 'The patch did not change the winner of any matching game.' : 'No games match this filter.'}</li>}
          </ol>
          {pages > 1 && <div className="replay-pager">
            <button className="button icon-button" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button>
            <span>Page {currentPage + 1} of {pages}</span>
            <button className="button icon-button" aria-label="Next page" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button>
          </div>}
        </aside>

        <div className="replay-theater">
          <div className="replay-theater-heading">
            <div>
              <h2>Game {game + 1}</h2>
              <p className="panel-description">Battle seed {matchup.seed} · Baseline: {winnerLabel(battles.before.winner, matchup, config)} in {battles.before.duration.toFixed(1)}s · Patched: {winnerLabel(battles.after.winner, matchup, config)} in {battles.after.duration.toFixed(1)}s</p>
            </div>
            <div className="replay-step">
              <button className="button subtle" disabled={position <= 0 && position !== -1} onClick={() => step(-1)}><ChevronLeft size={16} />Previous</button>
              <button className="button subtle" disabled={position >= visible.length - 1 && position !== -1} onClick={() => step(1)}>Next<ChevronRight size={16} /></button>
            </div>
          </div>
          <div className="replay-controls replay-shared-controls">
            <button className="button primary" onClick={() => { if (finished) setTime(0); setPlaying(!playing || finished); }}>
              {playing && !finished ? <Pause size={16} /> : finished ? <RotateCcw size={16} /> : <Play size={16} />}{playing && !finished ? 'Pause' : finished ? 'Replay both' : 'Play both'}
            </button>
            <input className="replay-timeline" type="range" min={0} max={duration} step={0.05} value={time} aria-label="Replay time" onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }} />
            <label className="speed-control">Playback<select aria-label="Playback speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
          </div>
          <div className="replay-boards">
            <ReplayBoard label="Baseline" result={battles.before} time={time} config={setup.baseline} highlighted={patchedIds} matchup={matchup} />
            <ReplayBoard label="Patched" result={battles.after} time={time} config={setup.patched} highlighted={patchedIds} matchup={matchup} />
          </div>
          <p className="board-help">Highlighted units carry a patched champion or item. Both boards replay the simulator's recorded movement and attacks on one shared clock.</p>
        </div>
      </div>
    </div>
  );
}
