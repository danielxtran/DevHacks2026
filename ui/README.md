# Player feedback → verified change

Front end for the Riot Track · Prompt 02 (Agentic Development) pipeline. Agents collect player feedback, turn the top issues into editable specs, build the change, and check it with bot playtests. A person approves each step.

This README describes the app as built. Keep it up to date when behavior changes.

The product spec is the team's front-end spec (Draft v2, kept outside this repo). The app follows it where it fills gaps, but keeps decisions made directly with the team where they differ: light mode, the Riot logo and Riot Sans typography, the Dev filter, separate List / Spec / Playtest / Verified pages, fictional games instead of TFT data, Reddit + X only, and a disabled Push to playtest patch button.

## Run it locally

```bash
cd ui
npm install        # first time only
npm run dev        # → http://localhost:5173 (opens your browser; port is fixed)
```

Production build: `npm run build && npm run preview` (→ http://localhost:4173).

## How an issue moves

Stages: **Feedback → Spec → Playtest → Verified**. Each issue page has a stepper with these four steps.

1. **Feedback / Identification** (`/issues/:id`). The Collector clusters posts from Reddit and X into an issue: summary, tags (editable only at this stage), the Sources box, a live-stat sanity check, mention trend, discussion, and an **Assign to** checklist. **Push to development →** stays disabled until at least one dev is checked. **Reject issue** opens a solid red "Are you sure?" block that needs a reason; rejected issues move to Closed and can be restored.
2. **Spec / Development** (`/issues/:id/spec`). The main view is the editable `spec.md` (mono, full height). Saving a hand edit or prompting the agent creates a new version. The prompt box grows as you type; sending it empty shows an inline error. While the agent rewrites, the editor is read-only and shows "Agent is rewriting…". **Rollback:** working from an older version *k* (editing or prompting) discards versions after *k*, and the new version becomes *k+1*. Summary, Full spec, Compare, and a structured Edit form are still available as tabs.
3. **Playtest / Testing** (`/issues/:id/playtest`). Approving the spec starts the Builder in the background; there is no separate build page. If a check fails, the Builder retries on its own (up to 3 attempts). Once every check passes, bots play 2,000 matches with 8 bot players each. The page shows the run line, three stat cards (matches run, avg damage dealt, avg time alive, each with "was …"), before/after win-rate bars per team comp with text readouts (before = grey, after = red), then the verdict, headline metric, and convergence chart. You then **Mark verified** or **← Back to development**, which reverts the change and takes you back to Spec.
4. **Verified** (`/issues/:id/verified`). The result, the approval, the code change, and a **Push to playtest patch** button (disabled for now; not connected yet).

### Versions

- **Spec:** a Version dropdown at the top lists every version with its author, plus "latest" and "approved" markers. Older versions are read-only. *Compare* diffs any two versions.
- **Playtest:** every playtest run is kept, labeled by spec version and run number (for example "Spec v2 · run 1 · current", "Spec v1 · run 1 · rejected"). Older runs are read-only and show the code change they tested.

## Board (`/`): Work Board

The page heading "Work Board" uses the large display size. Below it:

Four columns:

| Column | Holds |
|---|---|
| Issues | Feedback stage |
| Development | Spec stage |
| Testing | Background build + playtest |
| Closed | Verified or rejected |

- Queued, Verified, and Rejected cards show that status. Cards being worked on show a red ◆, a red outline, and the assigned devs' names. A card whose agent run failed gets an amber outline.
- Each card shows the title, a 1–3 sentence description, one small color dot per tag target used (unit blue, trait purple, item gold, augment teal, system grey, bug fix pink; hover lists the tags), and a footer with status or devs on the left and the mention count with a grey ↑ (upvotes) on the right.
- Filters (all combine): **Platform** (Reddit / X), **Date** (Reddit-style: past hour, today, this week, this month, this year, all time, matched against when the issue was first seen), **Tags** (the dot color categories: Unit, Trait, Item, Augment, System, Bug fix; matches any tag of that color; the selected category's dot shows inside the dropdown), and **Dev**.
- Empty columns say so ("No issues in testing.").

### Sources

The Sources box on the Identification view starts as one pill per platform with its post count (Reddit 300, X 450). Clicking a pill replaces the pills, in the same box, with that platform's posts:

- **← Back** returns to the pills; a keyword search bar matches post text or author
- infinite scroll, sorted by score (highest first), 15 posts at a time, loading more near the bottom
- each row shows the score and the post, which links to the original in a new tab (empty `href` until the backend is connected)
- a failing scraper shows "!" inside its pill with a Retry link

The hand-picked quotes from the Collector are marked "Representative". The rest of the cluster is generated per issue by `makeClusterPosts` in `src/data/generators.js`, matching the issue's per-source counts. In production these come from `GET /issues/:id/posts?platform=&q=&cursor=`.

## Tags and devs

- **Tags** come in two families. The catalog is `TAGS` in `src/data/constants.js`.
  - **Fix-type tags** are tinted pills. Color = what the fix targets: **Unit** blue, **Trait** purple, **Item** gold, **Augment** teal, **System** grey, **Bug fix** pink. Icon = direction: ↑ buff, ↓ nerf, ↔ adjust (⚙ system change, ✓ bug fix). Unit, Trait, Item, and Augment each have buff / nerf / adjust; then System change and Bug fix.
  - **Specific tags** are neutral pills with a dot in their target's color: units, abilities, and skins (blue: Ironvane, Kestrel, Solenne, Brakk, Shield Bash, Skyward Dash, Radiance, Ember skin), traits (purple: Vanguard, Skirmisher, Support), items (gold: Harpoon, Scattergun), augments (teal: Econ augments), systems (grey: Map, Economy, Ranked, Matchmaking, Netcode, VFX, UI, Performance, Bench).
  - Order on an issue: fix types first, then specific tags, each grouped by target.
  - Add a tag on the Identification view: pick **Fix type** or a target (Unit, Trait, Item, Augment, System), type a name (catalog names are suggested), and click **+ Add tag**. Fix types must come from the list; specific names not in the catalog are saved as custom tags for that target.
- **Devs:** Dev, Jun, Marco, Ana, Priya (`DEVS` in `src/data/constants.js`). Assign them on the issue page. `@Name` in a comment highlights them.

## List (`/feedback`)

Ranked list of issues with source counts, mentions, and trend. No page header; it opens straight on the controls. Sort, plus filters for source, dev, stage, last mention, and game. Each row's ⋯ menu merges a duplicate or rejects the issue. Untriaged rows show **Push to development** once a dev is assigned; until then they show **Assign a dev →**, which opens the issue's Assign to checklist. The same rule is enforced in the reducer (`SEND_TO_SPEC` does nothing without an assigned dev), so no screen can skip it.

## Demo path (≈3 minutes)

1. **List**: “Ironvane’s Shield Bash stun lasts too long” is #1. Optionally merge “Ironvane stun is broken” into it from its ⋯ menu.
2. Open it, browse the Reddit and X posts in Sources, check the stats sanity check, make sure a dev is checked under **Assign to** (Priya is), then click **Push to development →**.
3. **Spec**: watch the Spec Writer work, then ask it to “Make this a smaller nerf” or click *Edit*. Switch versions with the dropdown.
4. **Approve & send to playtest**. The Builder's first attempt says “done” but fails the *Tooltip ↔ data sync* check, so it retries. Attempt 2 passes and the bots start.
5. Verdict banner → **Mark verified** → Verified page. The checks and code diff are under *Code change*.

Other seeded issues sit at every stage (spec review, building, a playtest where the complaint is *not* backed by data, verified).

**Demo** menu (top right): make the next agent run fail (shows error + retry), break the Reddit scraper, clear all issues (empty → ingestion state), and reset demo data. State persists in localStorage under a versioned key; bumping `STORAGE_KEY` in `src/store/reducer.js` resets everyone's saved demo data.

## Look and feel

- Styling follows riotgames.com (checked Nov 2026): Riot Sans headings, Inter body text and numbers, red pill buttons whose fill slides to dark on hover, small uppercase nav, and Riot's neutral palette.
- Selection works like riotgames.com's nav: hovered and selected items get a translucent rounded box (the `.sel` class in `src/index.css`). It's used on the top nav (selected item also gets a red bar), the stage stepper (same), and the Spec view tabs.
- Popularity and post scores use a grey ↑ (`UpvoteIcon` in `src/components/ui.jsx`).
- Light and dark themes. The toggle is in the top bar. The first visit follows the OS setting, and the choice is saved in localStorage. Tokens for both themes live in `src/index.css`.

## Stack

Vite + React 19 · React Router · Tailwind CSS v4 (tokens in `src/index.css`) · Recharts · react-diff-viewer-continued.

## Where things live

| Path | What |
|---|---|
| `src/data/constants.js` | Stages, board columns, statuses, agents, subject tags, devs |
| `src/data/seed.js` | Seeded issues, posts, stats, tags, dev assignments (fictional games) |
| `src/data/generators.js` | Deterministic stand-ins for agent output: spec, rewrite, build + checks, playtest stats & verdict |
| `src/store/reducer.js` | All pipeline actions + simulated agent runs (keep running when you navigate away) |
| `src/hooks/useAgentStream.js` | `useAgentStream(issueId)`; swap its body for SSE/WebSocket to go live |
| `src/hooks/useTheme.js` | Light/dark theme state |
| `src/components/` | Shared pieces: tags, stepper, activity panel, approval gate, evidence, stat card, verdict, charts, diff, build summary |
| `src/pages/` | Board (`Overview.jsx`), List (`Feedback.jsx`), issue layout, and the Feedback / Spec / Playtest (+ Verified) pages |

## Connecting real agents

Replace the reducer's simulated `run` with server events. Keep the shapes (`Issue`, `specVersions[]`, `build`, `builds[]`, `playtest`, `playtests[]`) and the UI keeps working. Everything is keyed by issue ID.

## Riot assets

The logo (`src/components/RiotLogo.jsx`, plus the fist favicon in `public/riot-logo.svg`) and the Riot Sans font files in `public/fonts/` were copied from riotgames.com. Riot Sans is a proprietary typeface. Confirm with the Riot track organizers that using both is OK. If it isn't, delete `public/fonts/`; headings then fall back to Inter.
