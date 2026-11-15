# Getting started

This guide takes you from a fresh clone to the full demo: collecting feedback, discovering issues, running an experiment, and making a decision.

## Prerequisites

| Requirement | Why |
|---|---|
| **Node.js 22.12+** | Every app (Hexlab alone also runs on 20.19+) |
| macOS, Linux, or WSL | The launcher uses POSIX process groups |
| A hosted **Supabase** project | Postgres for every schema; no local Docker stack is needed |
| An **OpenAI API key** with billing, and a model that supports Responses function calling | Discovery and the Spec Writer. Optional if you only want collection and triage. |

## 1. Clone and install

```bash
git clone <repo-url> DevHacks2026 && cd DevHacks2026
for app in backend ui mockreddit mockr tft-clone; do npm --prefix "$app" ci; done
```

## 2. Configure Supabase

1. **Migrations.** For a new project, apply `supabase/migrations/0001`–`0008` in order. For the shared team project, follow the caution in the [migration guide](../supabase/migrations/README.md) first.
2. **Exposed schemas.** In Project Settings → Data API, expose `public`, `graphql_public`, `mockreddit`, and `mockr`.
3. **Public keys.** Copy `.env.example` to `.env` at the repository root and fill in:

   ```dotenv
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon / publishable key>
   ```

## 3. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Fill in at least:

```dotenv
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres   # from the Connect panel
OPENAI_API_KEY=sk-...
OPENAI_MODEL=<a Responses-capable model in your project>
```

Every other setting has a working local default. See [Configuration](configuration.md).

## 4. Start everything

```bash
./scripts/start.mjs
```

The launcher checks your Node version, installed dependencies, and free ports, then starts five apps with labeled output:

```text
  backend     http://127.0.0.1:3001
  ui          http://127.0.0.1:5173
  mockreddit  http://127.0.0.1:5174
  mockr       http://127.0.0.1:5175
  hexlab      http://127.0.0.1:3002 · http://127.0.0.1:5176
```

Press **Ctrl+C** to stop them all. If any app exits, the launcher stops the others.

To run a single app instead: `npm --prefix <app> run dev`.

## 5. Check that it works

```bash
curl -s http://127.0.0.1:3001/health | jq
# { "status": "ok", "database": "connected", "sources": true, "discovery": true, "workflow": true }

curl -s http://127.0.0.1:3001/sources | jq '.sources[] | {source, status, items}'
curl -s http://127.0.0.1:3002/api/health | jq
```

Within a few seconds the first sweeps finish. Within about a minute, Discovery has grouped the seed posts into issues, and they appear on the Board at http://127.0.0.1:5173.

## 6. Walk through the demo

1. **Post feedback.** Open Riotdit (http://127.0.0.1:5174/r/PatchworkTFT) or R (http://127.0.0.1:5175) and post a complaint, such as *"Yasuo's auto attacks shred everyone, he needs a nerf."*
2. **Watch Discovery.** Within one poll cycle and one model call, the post appears as evidence on a new or existing issue.
3. **Triage.** Open the issue. Assign a developer, edit tags, and leave a comment.
4. **Start an experiment.** The backend freezes the evidence and Hexlab's baseline, and the Spec Writer drafts version 1 of the spec.
5. **Review the spec.** Edit the markdown or numeric patch, or ask the Spec Writer for a revision. Each change creates a new version.
6. **Approve.** Choose a seed, mode, and battle count (100 / 1,000 / 5,000 / 10,000). Hexlab runs baseline and patched configurations on the same matchups.
7. **Review the results.** Compare win rates, damage, and survival with sample counts and 95% intervals. Use **Watch replays in Hexlab ↗** to see individual games.
8. **Decide.** Accept or reject. The issue moves to Closed only after this step.

The lifecycle behind these steps is in [Experiment workflow](workflow.md).

## After you pull

If a pull changes any `package.json` or `package-lock.json`, reinstall that app and restart:

```bash
git diff --name-only ORIG_HEAD HEAD -- '*/package*.json'
npm --prefix <app> ci
```

Vite reads dependencies at startup, so a dev server left running from before the pull fails with errors like `Failed to resolve import "@supabase/supabase-js"`.

If the pull adds a migration, apply it as described in the [migration guide](../supabase/migrations/README.md).

## Next steps

- [Architecture](architecture.md): how the pieces fit together
- [Backend API reference](api/backend-api.md): script against the backend
- [Development & testing](development.md): run the test suites before you push
