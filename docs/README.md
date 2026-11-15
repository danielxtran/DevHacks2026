# Patchwork documentation

Start with **[Getting started](getting-started.md)** if you want to run the project, or **[Architecture](architecture.md)** if you want to understand it.

## Guides

| | Guide | Read it when… |
|---|---|---|
| 🚀 | [Getting started](getting-started.md) | You're setting up the project for the first time |
| 🧭 | [Architecture](architecture.md) | You want the big picture: components, data flow, trust boundaries |
| ⚙️ | [Configuration](configuration.md) | You need to know what an environment variable does |
| 🧠 | [Backend internals](backend.md) | You're changing the collector, Discovery, Spec Writer, or job worker |
| 🔌 | [Backend API reference](api/backend-api.md) | You're calling the backend from the UI, a script, or `curl` |
| 🔁 | [Experiment workflow](workflow.md) | You need the lifecycle state machine, revisions, or idempotency rules |
| 🗄️ | [Database](database.md) | You're writing a query or a migration |
| 🧪 | [Development & testing](development.md) | You're about to open a pull request |
| 🩺 | [Troubleshooting](troubleshooting.md) | Something is broken |

## Contracts

- [Live tracker read contract](contracts/tracker-http-examples.md): the read endpoints the Pipeline UI relies on, and how it treats errors and stale data.
- [Hexlab agent API](../tft-clone/README.md#agent-api): `/api/config` and `/api/simulate`.
- [Riotdit public API](../mockreddit/API.md) and [R public API](../mockr/API.md): the source APIs the collector reads.

## Per-app READMEs

- [`backend/README.md`](../backend/README.md)
- [`ui/README.md`](../ui/README.md) and the preserved [simulator UI reference](../ui/SIMULATOR.md)
- [`tft-clone/README.md`](../tft-clone/README.md), [`DESIGN.md`](../tft-clone/DESIGN.md), [`ARCHITECTURE.md`](../tft-clone/ARCHITECTURE.md)
- [`mockreddit/README.md`](../mockreddit/README.md)
- [`mockr/README.md`](../mockr/README.md)
- [`supabase/migrations/README.md`](../supabase/migrations/README.md)

## Glossary

| Term | Meaning |
|---|---|
| **Feedback** | One post, comment, reply, or tweet collected from a source, stored in `public.feedback_posts`. |
| **Sweep** | One full pass over one source, from the newest page back through pagination. Recorded in `collection_sweeps`. |
| **Discovered issue** | A group of related feedback that the Discovery agent found (`discovered_issues`). |
| **Triage state** | `open`, `dismissed`, or `merged`. Set by people, never by an agent. |
| **Run / experiment** | One attempt to address an issue (`runs`). Numeric experiments have `experiment_kind = 'hexlab_numeric'`. |
| **Lifecycle phase** | Where a numeric experiment is: `spec_queued`, `spec_review`, `simulation_queued`, `simulation_review`, `accepted`, … See [workflow](workflow.md). |
| **Revision** | An integer that increases on every change to an issue or run. Commands send `expectedRevision`, so a stale tab can't overwrite newer work. |
| **Spec version** | An immutable draft of the experiment, written by the AI Spec Writer or a person: markdown plus a structured numeric patch. |
| **Numeric patch** | A list of `{ type, id, stat, value }` stat replacements that Hexlab can run. |
| **Baseline identity** | `baselineConfigId` (fingerprint of the configuration) plus `engineId` (SHA-256 of Hexlab's engine and simulation source files). Frozen when an experiment starts. |
| **Generation** | A counter on each run. Every new simulation request gets a new generation, and late results from older generations are ignored. |
| **Artifact** | An immutable file (model output, simulation result) stored on disk, with its SHA-256 recorded in `public.artifacts`. |
