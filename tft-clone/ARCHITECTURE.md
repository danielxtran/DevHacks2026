# Shared contracts and ownership

- `src/engine/types.ts`: shared contracts, coordinating agent owns. Stats are numeric; rates and confidence intervals are percentages (0–100), deltas are percentage points. Positions x/y are 0–4.
- Engine agent: owns `src/engine/*` except types; `tests/engine.test.ts`. Export `simulateBattle(teamA, teamB, config, seed, options?)`. Distinct ids across teams. Config includes monsters. Options can disable event recording for throughput.
- Analytics agent: owns `src/simulation/*`, `tests/simulation.test.ts`. Export `compareBalance(request, baselineConfig, onProgress?)` async from balanceComparison.ts. Export `runBatch(matchups, config, onProgress?)` async and `generateMatchups(count, seed, config, mode?)`. Progress callback receives 0–1. Imports `applyPatch` from `src/config/validation.ts`. Export worker message contract: input `{type:'compare',request,config}`, output `{type:'progress',progress}` / `{type:'result',result}` / `{type:'error',error}`. Keep worker integration in `src/simulation/worker.ts`.
- UI agent: owns `src/App.tsx`, `src/main.tsx`, `src/index.css`, `src/components/*`, `src/api/client.ts`. May consume contracts as above. Imports config/validation. Owns browser worker setup. No fabricated statistics. API is optional for browser usage.
- Coordinator: package/tooling, JSON config, validation, server, integration tests, README, integration fixes.

Methodology: balanced representation (difference at most one where feasible), side-swapped paired matchups, identical baseline/patch inputs, exclude champion mirror-team appearances from champion win-rate estimates, count draws as non-wins and report separately. PvE report clear rates. Per-unit performance may be collected separately from win-rate eligibility if labelled.
