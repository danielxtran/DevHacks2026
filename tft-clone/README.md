# Hexlab — Mini TFT Balance Simulator

A local, configuration-driven auto-battler and balance experiment dashboard. React + TypeScript + Vite + Tailwind, Recharts, Express, Zod, and Vitest. No database, AI API, authentication, or paid services. Combat and analytics run without a browser. Every metric is computed from simulated battles.

## Start

Requires Node.js **20.19+** (or 22.12+) and npm.

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. The API listens at **http://127.0.0.1:3001**. Vite proxies `/api` to Express. Run either independently with `npm run dev:web` or `npm run dev:api`.

```sh
npm test
npm run build
npm start
```

`build` type-checks all application, server, and test TypeScript, then creates the browser bundle in `dist/`. `start` starts the API; it does not serve `dist/`. Preview the built web app using `npx vite preview` while the API is running. The dashboard runs its own browser worker and does not require the API for battles or analytics.

For a headless evaluation with JSON output:

```sh
npm run simulate -- examples/yasuo-nerf.json
```

Use `npx tsx scripts/simulate.ts examples/yasuo-nerf.json > result.json` for a pure JSON file without npm's script banner.

## Demo flow

1. In Battle Arena, configure the three slots on each team, choose equipment, and place units on the 5×5 board. Run a battle, then replay at different speeds.
2. Select Yasuo in the champion editor. Change attack damage from 25 to 20. The baseline is preserved. Item bonuses and Krug stats can also be edited.
3. Choose **5,000** simulations, seed **42**, and compare the patch. Progress updates while the browser worker computes the results.
4. Inspect Yasuo and other champions in the before/after charts and the table. Item and composition performance come from the same experiment. Modified champions are marked.
5. Switch to PvE to evaluate a three-champion team against Krug. PvE success is **clear rate**.
6. Reset the configuration to discard the patch. Changes are session-local; they do not rewrite source files.

Batch experiments sample the full roster; they do not repeat only the manually configured exhibition battle. Combat replay uses actual engine events, independently of the batch results.

## Agent API

### Health and configuration

```sh
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/config
```

`GET /api/config` returns `id`, `baselineConfigId`, `champions`, `items`, and `monsters`. Use the IDs and bounds in this document to construct patches. The baseline identifier includes a deterministic content fingerprint, so your agent can record which baseline it evaluated.

### Evaluate a patch

```sh
curl -X POST http://127.0.0.1:3001/api/simulate \
  -H 'Content-Type: application/json' \
  --data-binary @examples/yasuo-nerf.json
```

Equivalent minimal request:

```json
{
  "changes": [{ "type": "unit", "id": "yasuo", "stat": "attackDamage", "value": 20 }],
  "simulations": 5000,
  "seed": 42,
  "mode": "pvp"
}
```

- `changes` is required; an empty array evaluates the unchanged baseline. Maximum 100 changes. Values **replace** stats rather than incrementing them. Multiple edits to one stat are applied in order; the last wins.
- `type`: `unit`, `item`, or `monster`.
- Unit IDs: `garen`, `darius`, `yasuo`, `jinx`, `ahri`, `ashe`, `leona`. Monster: `krug`. Items: `bf_sword`, `recurve_bow`, `chain_vest`.
- `simulations`: exactly 100, 1000, 5000, or 10000. This is games **per configuration**; a comparison runs twice this many battles.
- `seed`: integer from 0 through 4294967295.
- `mode`: `pvp` (default) or `pve`.

Response structure (numeric values are computed, not fixed examples):

| Field | Meaning |
|---|---|
| `baselineConfigId` | Version and content fingerprint of baseline |
| `appliedChanges` | Validated list applied to a copy of baseline |
| `simulations`, `seed`, `mode` | Experiment inputs |
| `before`, `after` | `BatchStatistics` for the same matchup set |
| `before.champions[id]`, `after.champions[id]` | Champion metrics |
| `before.items[id]`, `after.items[id]` | Item-holder team metrics |
| `before.compositions[key]`, `after.compositions[key]` | Composition metrics |
| `before.clearRate`, `after.clearRate` | PvE only, percent of player-team clears |
| `differences.champions[id]`, `differences.items[id]` | After minus before |
| `differences.clearRate` | PvE clear-rate difference, percentage points |
| `methodology` | Sampling/denominator explanation |
| `evaluationDurationMs` | Measured wall time, intentionally not deterministic |

Each metric includes `samples`, `wins`, `draws`, `winRate`, `confidenceInterval` (two endpoints), `averageDamageDealt`, `averageDamageTaken`, and `averageSurvivalDuration` (seconds). All rates/CI endpoints use **0–100 percent**. Win-rate differences use **percentage points**. Performance differences use the original metric units. `games` and `draws` are also recorded at batch level. Types are defined in `src/engine/types.ts`.

Invalid IDs, unknown fields, invalid stats, non-numeric/non-finite values, and malformed JSON return **400**. Bodies are limited to 64 KB (**413**). Two evaluations can run concurrently; excess requests receive **429** and should retry. Evaluation failures return **500**. API evaluations have a 120-second limit and run in Node worker threads so the server remains responsive. Baseline files are never changed by an API request.

Local CORS origins include localhost/127.0.0.1 ports 5173 and 4173. Override with a comma-separated `CORS_ORIGINS` environment variable. Change the API port using `PORT` (update the Vite proxy when changing it). The API binds to loopback by default; no authentication is provided for this local hackathon tool.

### Teammate integration

Your feedback/patch agent should:

1. Fetch `/api/config` and retain `baselineConfigId`.
2. Produce only structured numeric changes using known IDs.
3. Submit `/api/simulate` using a fixed seed and sample count.
4. Read `before`, `after`, and `differences`; retain all sample counts and uncertainty intervals.
5. Store the request and returned baseline identifier with its recommendation. Do not infer a statistically meaningful improvement solely from a point estimate.

The browser and server share `applyPatch`, `simulateBattle`, and `compareBalance`. Agents can also call these directly in TypeScript:

```ts
import { baseConfig } from './src/config/index';
import { compareBalance } from './src/simulation/balanceComparison';
const result = await compareBalance({
  changes: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 20 }],
  simulations: 5000, seed: 42, mode: 'pvp',
}, baseConfig);
console.log(result.before.champions.yasuo, result.after.champions.yasuo);
```

## Configuration

All initial stats live in human-readable files:

- `src/config/champions.json`
- `src/config/items.json`
- `src/config/monsters.json`

To permanently change a baseline champion, edit its numeric fields in `champions.json`, then restart the API/reload the web app. Configuration validation runs before evaluation. UI/API changes affect only a cloned modified configuration.

| Stat | Unit/monster limits | Item bonus limits |
|---|---|---|
| `hp` | 1–10000 | Not permitted |
| `attackDamage` | 0–1000 | 0–1000 |
| `attackSpeed` | 0.1–5 attacks/second | 0–5 attacks/second |
| `armor` | 0–500 | 0–500 |
| `range` | Integer 1–4 tiles | Not permitted |

Each unit may have one item; its three bonuses are added before combat. Empty item assignment removes it. Initial items: B. F. Sword (+15 AD), Recurve Bow (+0.3 AS), Chain Vest (+25 armor). Krug starts with 300 HP, 20 AD, 0.7 AS, 10 armor, and range 1.

### Add a champion

Add a new lowercase ID entry to `champions.json` with `name`, `role`, `hp`, `attackDamage`, `attackSpeed`, `armor`, `range`, and optional `portrait` (unit marker key, e.g. `Garen`). The editor and seeded sampler discover the configuration keys automatically. Use a stable ID matching `[a-z][a-z0-9_]{0,49}`. The engine does not branch on champion IDs. Run tests and build. The display uses neutral Lucide unit markers and initials. This simplified model intentionally has no champion spells, mana, traits, synergies, or leveling.

## Simulation methodology

- Fixed-time combat on a 5×5 square board; Manhattan distance for range and targeting. Nearest living enemies are chosen with deterministic ties. Collision-aware movement reserves tiles, preventing overlaps.
- Damage: `rawDamage * 100 / (100 + max(armor, 0))`. Damage attribution is capped to remaining HP; overkill is not counted. Attack speed controls attack intervals. Already-dead units cannot attack. Battles end on elimination or a fixed timeout with an explicit draw.
- Seeded matchup generation produces reproducible compositions, legal placements, items, and combat seeds. Side-swapped pairs control board side effects. Champion representation is stratified across the roster. PvP generation avoids champion mirrors; aggregation excludes mirrored champion appearances if custom matchups contain them.
- Baseline and modified simulations reuse **exactly the same matchups and battle seeds**. A patch cannot influence sampling. Identical inputs reproduce all metrics; elapsed evaluation time may differ.
- Champion win rate is the proportion of eligible team appearances that win. Draws count as non-wins and are reported separately. Per-champion performance uses the same eligible appearances. Item rates use team presence and exclude cross-team mirrored items; holder damage/survival is averaged within that team appearance. Composition samples correspond to team appearances.
- Wilson 95% intervals describe individual win/clear-rate estimates. Side-swapped observations and shared teams are correlated, so these are descriptive approximate intervals, not a paired significance test or proof a patch improves balance. Composition estimates may have few samples; always inspect the displayed denominator.
- PvE metrics describe clearing Krug, not competitive strength. This is a deliberately simplified model; simulated results are not predictions of live TFT balance.

## Structure

```text
src/engine/       Headless combat and shared TypeScript types
src/config/       Baseline JSON, schema validation, safe patch application
src/simulation/   Seeded matchups, aggregation, comparisons, browser worker
src/components/   Arena replay, patch editor, controls, charts
src/api/          Frontend integration helper
server/           Express endpoints and Node evaluation worker
examples/         Agent request JSON
scripts/          Headless JSON evaluation CLI
tests/            Engine, reproducibility, validation, API integration tests
```

## Visual foundations

The interface uses the tokens, typography, breakpoints, and accessibility conventions in [DESIGN.md](DESIGN.md). Inter, Space Grotesk, and JetBrains Mono are served locally with their SIL Open Font Licenses in `public/fonts/`. The banner, favicon, and unit markers use independent geometry and Lucide icons; the UI does not request Riot champion artwork.

## Independent prototype notice

Hexlab is an independent hackathon prototype. Riot Games does not endorse it or represent its views. Champion names remain sample configuration labels. No Riot logos or game artwork appear in the interface. See [Riot's third-party policies](https://support-developer.riotgames.com/hc/en-us/articles/22698591841939-General-Policies) and [Legal Jibber Jabber](https://www.riotgames.com/en/legal) before distributing a derivative project.
