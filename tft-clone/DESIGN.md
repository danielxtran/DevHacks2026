# Hexlab visual foundations

Hexlab is an independent balance simulator. The arena, team builders, patch editor, batch controls, and analytics remain the primary working areas. The visual direction follows the supplied Riot-inspired brief, with independent Hexlab geometry and neutral unit markers.

## Reference verification

Inspected https://www.riotgames.com/en in Chrome DevTools on November 14, 2026. The live page includes `rgb(209, 54, 57)` (`#D13639`) as an accent, `#1F1F1F` and `#252423` among dark backgrounds, and `#E7E6E3` body text. The site's palette varies by section; Hexlab deliberately uses the brief's `#111111` background and `#ECE8E1` warm foreground rather than claiming an exact copy.

The current https://www.riotgames.com/en/who-we-are lists Player First, Serious About Games, Dream and Deliver, In for the Long Term, and One Riot. The historical list in the brief is superseded. Product copy emphasizes testing changes for better player experiences without implying a player-feedback ingestion feature that this simulator does not have.

## Tokens

All shared colors live in `src/index.css`; charts use the same CSS custom properties.

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#111111` | Page and input background |
| `--surface` | `#1A1A1A` | Main panels and banner |
| `--surface-raised` | `#222222` | Selection and grouped content |
| `--border` | `#2E2E2E` | Decorative hairlines |
| `--border-control` | `#6B665F` | Identifiable input boundaries |
| `--text-primary` | `#ECE8E1` | Warm primary text |
| `--text-muted` | `#A6A29B` | Secondary text, lifted from the proposed value for dark-panel legibility |
| `--accent-red` | `#D13639` | Primary actions and modified data series |
| `--accent-red-hover` | `#B92E32` | Primary action hover |
| `--accent-red-soft` | `#D1363926` | 15% accent tint |
| `--accent-text` | `#F09999` | Readable labels on accent-tinted surfaces |
| `--success` | `#9CBEA8` | Completed runs and positive deltas |
| `--warning` | `#D6BA87` | Stale results |
| `--info` | `#A1B9CA` | Baseline chart series |
| `--team-a` | `#8BB5CB` | Team A markers and health |
| `--team-b` | `#E59898` | Team B markers, health, and negative deltas |

Keep accent actions distinct from semantic errors. Team names, modified labels, signed numbers, and status copy accompany color so the interface does not depend on hue alone.

## Typography and layout

- Space Grotesk 700: display title, major headings, and large measurements. Page title scales from 40 to 64px with tight tracking.
- Inter 400–700: body text, labels, controls, and explanatory copy.
- JetBrains Mono 400–500: code, configuration IDs, measured values, and result metadata.
- Font files and licenses are local in `public/fonts/`; the app needs no external font or portrait requests.
- Main content is centered with a 1536px maximum width. The static banner supplies the strongest brand expression. Content uses generous section spacing, quiet borders, and clear heading hierarchy.
- Above 1300px: arena, compact team column, and patch workbench. From 801px: arena and workbench columns. At 800px and below: stacked workspace, with editor and simulation controls side by side when room permits. At 600px and below: stacked controls and team builders, wrapped navigation, and simplified banner artwork. 1000px and 1200px adjustments preserve control space; above 1600px the board can grow.
- Analytics charts form a two-column grid on desktop and stack below 800px. Dense result tables scroll within a labeled, keyboard-focusable region.

## Interaction and assets

Use direct action copy: Start battle, Compare patch, Run baseline, Run patched, Export JSON. Keep work-in-progress feedback tied to real simulation progress. Only the working indicator pulses; reduced-motion preferences disable it and movement transitions.

Maintain visible focus, a skip link, named inputs, status announcements, semantic dialogs, and touch-friendly primary actions. Primary button text is white for sufficient contrast on red. Decorative dividers and input boundaries use separate tokens.

`public/hexlab-banner.svg` and `public/hexlab-icon.svg` are original geometric Hexlab assets. Unit markers use Lucide icons and initials. Champion names are sample configuration labels; no Riot logos or champion artwork are loaded.

The mechanical style scan flags Inter and Space Grotesk as common font choices. They are intentional here because both are explicitly requested in the brief.
