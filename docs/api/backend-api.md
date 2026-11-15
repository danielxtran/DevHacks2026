# Backend API reference

Base URL: `http://127.0.0.1:3001` (set with `API_PORT`). The Pipeline UI reaches it as `/api/*` through Vite's proxy.

- **Format:** JSON in and out. Request bodies are limited to 256 KB and parsed strictly. Unknown fields are rejected.
- **Caching:** every response sends `Cache-Control: no-store`.
- **Auth:** none. The server binds only to loopback.
- **IDs:** path IDs must be UUIDs; anything else gets `400 invalid_request`.
- **Actors:** `actor` is a free-text name, 1–100 characters, recorded on every change. Developer assignments must be one of `dev`, `jun`, `marco`, `ana`, `priya`.

For the lifecycle these commands drive, see [Experiment workflow](../workflow.md).

## Contents

- [Errors](#errors)
- [Status](#status): `/health`, `/capabilities`, `/sources`
- [Issues](#issues): list, detail, runs, metadata, comments, dismiss, restore, merge
- [Experiments](#experiments): start, status, specs, simulations, artifacts
- [Spec commands](#spec-commands): edit, revise, approve, reject
- [Simulation commands](#simulation-commands): re-run, retry, return to development
- [Decisions](#decisions)
- [Legacy endpoints](#legacy-endpoints)

## Errors

| Status | Body | Meaning |
|---|---|---|
| `400` | `{ "error": "invalid_request", "details": [{ "path": [...], "message": "..." }] }` | Body or path failed schema validation |
| `400` | `{ "error": "invalid_…" }` | A domain validation error, such as an invalid numeric patch |
| `404` | `{ "error": "issue_not_found" \| "run_not_found" \| "simulation_not_found" \| "spec_version_not_found" \| "artifact_not_found" \| "not_found" }` | Missing resource or route |
| `409` | `{ "error": "<code>" }` | Conflict; see the table below |
| `503` | `{ "error": "...", "detail": "..." }` | A required dependency (OpenAI or Hexlab) isn't configured or can't be reached |
| `500` | `{ "error": "internal_error" }` | Unexpected; details go to the server log only |

### Conflict codes (409)

| Code | Raised when |
|---|---|
| `issue_revision_conflict`, `run_revision_conflict` | `expectedRevision` is stale. Re-read and try again. |
| `idempotency_conflict` | The key was already used for a different request |
| `active_run_exists` | This issue already has an unfinished experiment, or an issue involved in a merge has one. Numeric experiments on different issues can proceed independently. |
| `issue_not_open` | Starting an experiment on a dismissed or merged issue |
| `developer_assignment_required` | Starting an experiment without an assigned developer |
| `cannot_merge_issue_into_self`, `merge_target_not_canonical` | Invalid merge |
| `not_numeric_experiment` | A numeric command was sent to a legacy run |
| `spec_not_ready`, `current_spec_missing` | No spec version yet |
| `spec_not_in_review`, `spec_version_conflict`, `spec_version_not_current` | The spec changed or isn't in review |
| `workflow_job_active` | A job is already queued or running for this run |
| `baseline_identity_changed` | The approval's `baselineConfigId` / `engineId` doesn't match the frozen run |
| `patch_differs_from_saved_spec` | The approved patch isn't the one saved in that spec version |
| `simulation_not_rerunnable`, `simulation_not_retryable`, `simulation_retry_limit_reached`, `simulation_generation_retired`, `approved_inputs_missing` | Invalid re-run or retry |
| `experiment_finalized` | The run is `accepted`, `experiment_rejected`, or `spec_rejected` |
| `experiment_not_ready_for_decision`, `simulation_identity_mismatch`, `decision_conflict` | Invalid decision |
| `run_not_interrupted` | `resume` on a run that isn't interrupted |

---

## Status

### `GET /health`

Checks the database connection and reports which features are configured.

```json
{ "status": "ok", "database": "connected", "sources": true, "discovery": true, "workflow": true }
```

`discovery` is `true` only when both `OPENAI_API_KEY` and `OPENAI_MODEL` are set. If the database query fails, the response is `500`.

### `GET /capabilities`

Says which UI features are enabled and, if not, why. The UI uses this to disable buttons with an explanation.

```json
{
  "capabilities": {
    "issueMetadata":  { "enabled": true },
    "discussion":     { "enabled": true },
    "triage":         { "enabled": true },
    "merge":          { "enabled": true },
    "startExperiment":{ "enabled": true,  "reason": null },
    "specWriter":     { "enabled": true,  "reason": null },
    "simulation":     { "enabled": true,  "reason": null },
    "sourceRetry":    { "enabled": false, "reason": "Collection runs on its paced backend schedule; manual retry is unavailable." },
    "deployment":     { "enabled": false, "reason": "Deployment is not implemented for this workflow." }
  }
}
```

### `GET /sources`

The most recent collection sweep for each source.

```json
{
  "sources": [
    { "source": "r", "status": "complete", "pages": 2, "items": 140, "truncated": false, "error": null,
      "started_at": "2026-11-14 18:00:00+00", "completed_at": "2026-11-14 18:00:12+00" },
    { "source": "reddit", "status": "incomplete", "pages": 5, "items": 500, "truncated": true, "error": "item cap reached", "...": "..." }
  ]
}
```

`status` is one of `running`, `complete`, `incomplete` (item cap reached, or replies still waiting for their parent), or `failed`. A missing source means no sweep has been recorded. It doesn't mean the source is healthy.

---

## Issues

### `GET /issues`

Every **active** discovered issue, most recently updated first.

```json
{
  "issues": [{
    "id": "uuid",
    "title": "Yasuo feels oppressive in the early game",
    "discovery_title": "…",
    "summary": "…",
    "category": "too_strong",
    "target": "Yasuo",
    "target_type": "unit",
    "tags": ["Unit nerf", "Yasuo"],
    "human_title": null,
    "human_tags": null,
    "assigned_developer": "ana",
    "triage_state": "open",
    "canonical_issue_id": null,
    "revision": 4,
    "dismissed_by": null, "dismissed_reason": null, "dismissed_at": null,
    "first_seen_at": "…", "last_seen_at": "…", "last_feedback_at": "…",
    "feedback_count": 7,
    "source_counts": { "reddit": 4, "r": 3 },
    "latest_run": {
      "id": "uuid", "status": "review", "stage": "simulation_review", "phase": "simulation_review",
      "kind": "hexlab_numeric", "revision": 6, "currentSpecVersionId": "uuid", "approvedSpecVersionId": "uuid",
      "error": null, "attempt": 0, "decision": null, "reviewer": null, "decidedAt": null, "createdAt": "…"
    }
  }]
}
```

- `title` and `tags` already include human overrides. `discovery_title` is the agent's original title.
- `category` is one of `too_strong`, `too_weak`, `feels_bad`, `bug`, `other`.
- `feedback_count` counts posts, comments, and replies. It is not a count of unique players.
- `source_counts.r` is the R microblog.

### `GET /issues/:issueId`

Returns one issue with its evidence and activity log. Inactive issues return `404`.

```json
{
  "issue": {
    "...": "same fields as the list, minus counts and latest_run",
    "feedback": [{
      "id": "mr_abc", "source": "reddit", "externalId": "t1_abc", "kind": "comment",
      "title": null, "body": "…", "author": "anon_x1y2z3", "score": 12, "postedAt": "…",
      "sourceUrl": "http://127.0.0.1:5174/r/PatchworkTFT/post/…", "parentId": "mr_…",
      "threadId": "mr_…", "numComments": null
    }],
    "activity": [{ "id": "uuid", "type": "comment", "actor": "ana", "text": "…", "details": {}, "createdAt": "…" }]
  }
}
```

Activity `type` is one of `metadata_updated`, `comment`, `dismissed`, `restored`, `merged`, `experiment_started`, `experiment_finalized`, `spec_version_saved`, `spec_rejected`, `returned_to_development`.

### `GET /issues/:issueId/runs`

Every run for an issue, newest first: `{ "runs": [{ id, status, stage, phase, kind, revision, error, current_spec_version_id, approved_spec_version_id, simulation_generation, created_at, decision, reviewer, decided_at }] }`.

### `PATCH /issues/:issueId`

Assign a developer, rename the issue, or set tags. Include at least one of the three.

```json
{ "expectedRevision": 3, "actor": "marco", "developer": "ana", "title": "Yasuo early-game AD", "tags": ["Unit nerf"] }
```

`developer: null` unassigns. Titles are 1–200 characters; up to 20 tags of 1–50 characters each. → `200 { "issue": { ... } }`

### `POST /issues/:issueId/comments`

```json
{ "expectedRevision": 3, "actor": "ana", "text": "Confirmed in my games too." }
```

`text` is 1–5000 characters. → `201 { "comment": { ... } }`

### `POST /issues/:issueId/dismiss`

```json
{ "expectedRevision": 3, "actor": "ana", "reason": "Duplicate of a fixed bug" }
```

→ `204`

### `POST /issues/:issueId/restore`

```json
{ "expectedRevision": 4, "actor": "ana" }
```

→ `204`

### `POST /issues/:issueId/merge`

Merges `:issueId` into `canonicalIssueId`. Send both issues' revisions.

```json
{ "expectedRevision": 2, "expectedCanonicalRevision": 5, "actor": "jun", "canonicalIssueId": "uuid" }
```

→ `200 { "issue": { "id", "canonicalIssueId", "revision", "canonicalRevision" } }`

---

## Experiments

### `POST /issues/:issueId/runs`

Start a numeric Hexlab experiment for an issue.

```json
{ "idempotencyKey": "start-2f9a…", "actor": "ana" }
```

→ `202`

```json
{ "run": { "id": "uuid", "status": "queued", "workflow_stage": "spec_queued", "error": null,
           "baseline_revision": null, "candidate_revision": null, "created_at": "…" } }
```

| Error | When |
|---|---|
| `503 spec_writer_not_configured` | No OpenAI key or model |
| `503 hexlab_not_configured` / `503 hexlab_unavailable` | Hexlab isn't running, or its config failed identity validation |
| `409 active_run_exists`, `issue_not_open`, `developer_assignment_required`, `idempotency_conflict` | See [conflict codes](#conflict-codes-409) |

### `GET /runs/:runId`

Run status, stage history, the decision, and per-run capabilities.

```json
{
  "run": {
    "id": "uuid", "status": "review", "workflow_stage": "spec_review", "lifecycle_phase": "spec_review",
    "experiment_kind": "hexlab_numeric", "revision": 2, "error": null,
    "baseline_config_id": "…", "engine_id": "…",
    "current_spec_version_id": "uuid", "approved_spec_version_id": null,
    "simulation_generation": 0, "current_attempt": 0,
    "created_at": "…", "started_at": null, "finished_at": null
  },
  "stages": [{ "stage": "…", "status": "complete", "error": null, "startedAt": "…", "completedAt": "…" }],
  "decision": null,
  "capabilities": {
    "editSpec":    { "enabled": true, "reason": null },
    "approveSpec": { "enabled": true, "reason": null },
    "simulation":  { "enabled": true, "reason": null }
  }
}
```

### `GET /runs/:runId/specs`

Every spec version, oldest first, plus the Spec Writer jobs.

```json
{
  "versions": [{
    "id": "uuid", "version_number": 1, "parent_version_id": null,
    "author_kind": "ai", "author": "Spec Writer",
    "markdown": "# Reduce Yasuo attack damage\n…",
    "structured_spec": { "hypothesis": "…", "evidenceAssessment": "supported", "evidenceRationale": "…",
      "evidenceIds": ["mr_…", "r_…"], "intendedChanges": ["…"], "preservedBehavior": ["…"],
      "successCriteria": ["…"], "unsupportedReason": null },
    "numeric_patch": [{ "type": "unit", "id": "yasuo", "stat": "attackDamage", "value": 20 }],
    "note": "", "created_at": "…", "design_artifact_id": "uuid",
    "current": true, "approved": false
  }],
  "jobs": [{ "id": "uuid", "kind": "spec_initial", "state": "succeeded", "prompt": null, "result": { "specVersionId": "uuid", "version": 1 },
             "error": null, "attempt": 1, "created_at": "…", "completed_at": "…" }]
}
```

### `GET /runs/:runId/simulations`

Every simulation for the run, oldest first. Each entry has `id`, `spec_version_id`, `approval_id`, `job_id`, `generation`, `state` (`queued`, `running`, `succeeded`, `failed`, `interrupted`, `retired`), `baseline_config_id`, `engine_id`, `numeric_patch`, `seed`, `mode`, `battles`, `result` (the full validated Hexlab response), `error`, timestamps, `attempt`, `max_attempts`, and the frozen `baseline_config`.

The shape of `result` is documented in the [Hexlab API](../../tft-clone/README.md#evaluate-a-patch).

### `GET /runs/:runId/artifacts`

`{ "artifacts": [{ id, run_id, kind, logical_path, media_type, sha256, size_bytes, created_at }] }`

### `GET /artifacts/:artifactId`

The raw artifact bytes, served with the stored media type. The SHA-256 and size are checked before the file is sent; on a mismatch, the request fails with `500`.

---

## Spec commands

All of these require the run to be in `spec_review` (except as noted).

### `PATCH /runs/:runId/specs`: save a human version

```json
{
  "expectedRevision": 2, "actor": "ana", "expectedVersion": 1,
  "markdown": "…edited…",
  "numericPatch": [{ "type": "unit", "id": "yasuo", "stat": "attackDamage", "value": 21 }],
  "note": "Smaller step first"
}
```

Include at least one of `markdown`, `numericPatch`, or `baseSpecVersionId`. Fields you leave out are copied from the base version, which is the current version unless `baseSpecVersionId` names another one (use that to roll back). → `201 { "runId", "version": { "id", "version" } }`

### `POST /runs/:runId/spec-revisions`: ask the Spec Writer

```json
{ "expectedRevision": 2, "actor": "ana", "idempotencyKey": "rev-…", "expectedVersion": 1,
  "prompt": "Try reducing attack speed instead of attack damage." }
```

→ `202 { "runId", "jobId", "status": "queued" }`. The phase becomes `spec_queued` until the new version is saved.

### `POST /runs/:runId/spec-approval`: approve and simulate

```json
{
  "expectedRevision": 3, "actor": "ana", "idempotencyKey": "approve-…",
  "specVersionId": "uuid",
  "baselineConfigId": "…", "engineId": "<64 hex>",
  "numericPatch": [{ "type": "unit", "id": "yasuo", "stat": "attackDamage", "value": 20 }],
  "seed": 42, "mode": "pvp", "battles": 1000
}
```

- `seed`: an integer from 0 to 4294967295
- `mode`: `pvp` or `pve`. Monster patches require `pve`.
- `battles`: exactly `100`, `1000`, `5000`, or `10000` per configuration
- `numericPatch` must equal the saved version's patch after canonical sorting

→ `202 { "runId", "simulationId", "status": "queued" }`

### `POST /runs/:runId/spec-rejection`

```json
{ "expectedRevision": 3, "actor": "ana", "specVersionId": "uuid", "reason": "Wrong target" }
```

→ `204`. This is terminal: the phase becomes `spec_rejected`.

---

## Simulation commands

### `POST /runs/:runId/simulations`: re-run with another sample size

Allowed from `simulation_review` or `failed`. The patch, seed, and mode stay frozen.

```json
{ "expectedRevision": 5, "actor": "ana", "idempotencyKey": "rerun-…", "battles": 5000 }
```

→ `202 { "runId", "simulationId", "status": "queued" }`

### `POST /runs/:runId/simulations/:simulationId/retry`

Re-queues a `failed` or `interrupted` simulation of the current generation, as long as attempts remain.

```json
{ "expectedRevision": 5, "actor": "ana", "idempotencyKey": "retry-…" }
```

→ `202 { "runId", "simulationId", "status": "queued" }`

### `POST /runs/:runId/return-to-development`

Retires queued and running jobs, invalidates the approval, and moves the run back to `spec_review`.

```json
{ "expectedRevision": 5, "actor": "ana", "reason": "Patch is too aggressive" }
```

→ `204`

---

## Decisions

### `POST /runs/:runId/decision`

**Numeric experiments.** Send the body with `specVersionId`:

```json
{ "expectedRevision": 6, "actor": "ana", "decision": "accept", "comment": "Win rate back in band.",
  "specVersionId": "uuid", "simulationId": "uuid" }
```

The run must be in `simulation_review`, `specVersionId` must be the approved version, and `simulationId` must be a succeeded simulation with a matching identity. → `201 { "runId", "decision", "candidateIdentity" }`. The phase becomes `accepted` or `experiment_rejected`.

**Legacy source-code runs.** Send the body without `specVersionId`:

```json
{ "decision": "reject", "reviewer": "ana", "comment": "", "candidateRevision": "<git sha>" }
```

---

## Legacy endpoints

### `POST /runs/:runId/resume`

Re-queues a legacy run that is `interrupted`. → `202 { "runId", "status": "queued", "stage": "resume_requested" }`

## Example session

```bash
API=http://127.0.0.1:3001
ISSUE=$(curl -s $API/issues | jq -r '.issues[0].id')
REV=$(curl -s $API/issues/$ISSUE | jq '.issue.revision')

# Assign a developer, then start an experiment
curl -s -X PATCH $API/issues/$ISSUE -H 'content-type: application/json' \
  -d "{\"expectedRevision\":$REV,\"actor\":\"ana\",\"developer\":\"ana\"}"
RUN=$(curl -s -X POST $API/issues/$ISSUE/runs -H 'content-type: application/json' \
  -d '{"idempotencyKey":"demo-1","actor":"ana"}' | jq -r '.run.id')

# Watch it reach spec_review
watch -n2 "curl -s $API/runs/$RUN | jq '.run.lifecycle_phase'"
```
