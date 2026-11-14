import { z } from 'zod';

export const SourceSchema = z.enum(['reddit', 'r']);
export const FeedbackKindSchema = z.enum(['post', 'comment']);

export const FeedbackSchema = z.object({
  id: z.string().min(1),
  external_id: z.string().min(1),
  source: SourceSchema,
  fixture_set: z.literal('mock-live'),
  kind: FeedbackKindSchema,
  parent_id: z.string().min(1).nullable(),
  thread_id: z.string().min(1).nullable(),
  title: z.string().max(300).nullable(),
  body: z.string(),
  score: z.number().int(),
  author: z.string().min(1),
  posted_at: z.string().datetime({ offset: true }),
  num_comments: z.number().int().nonnegative().nullable(),
  source_url: z.string().url(),
}).superRefine((row, ctx) => {
  if (row.kind === 'post' && (row.parent_id !== null || row.thread_id !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Root posts cannot have parent or thread IDs.' });
  }
  if (row.kind === 'comment' && (!row.parent_id || !row.thread_id || row.title !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Comments require parent/thread IDs and have no title.' });
  }
  if (row.source === 'reddit' && (!/^t[13]_.+/.test(row.external_id) || row.id !== `mr_${row.external_id.slice(3)}`)) {
    ctx.addIssue({ code: 'custom', message: 'Riotdit IDs must map consistently from t3_/t1_ external IDs.' });
  }
  if (row.source === 'r' && row.id !== `r_${row.external_id}`) {
    ctx.addIssue({ code: 'custom', message: 'R IDs must map consistently from their raw external IDs.' });
  }
});
export type Feedback = z.infer<typeof FeedbackSchema>;

const RedditCommentSchema = z.object({
  id: z.string(), name: z.string(), parent_id: z.string(), author: z.string(), body: z.string(),
  score: z.number().int(), created_utc: z.number().int(),
});
const RedditPostSchema = z.object({
  id: z.string(), name: z.string(), title: z.string(), selftext: z.string(), author: z.string(),
  score: z.number().int(), created_utc: z.number().int(), num_comments: z.number().int().nonnegative(),
  permalink: z.string(), subreddit: z.string(), comments: z.array(RedditCommentSchema),
});
export const RedditListingSchema = z.object({
  kind: z.literal('Listing'),
  data: z.object({
    after: z.string().nullable(),
    dist: z.number().int().nonnegative(),
    children: z.array(z.object({ kind: z.literal('t3'), data: RedditPostSchema })),
  }),
});

const TweetSchema = z.object({
  id: z.string(), text: z.string(), author_id: z.string(), created_at: z.string().datetime({ offset: true }),
  conversation_id: z.string(),
  public_metrics: z.object({ like_count: z.number().int(), retweet_count: z.number().int(), reply_count: z.number().int(), quote_count: z.number().int() }),
  referenced_tweets: z.array(z.object({ type: z.literal('replied_to'), id: z.string() })),
});
export const RSearchSchema = z.object({
  data: z.array(TweetSchema),
  includes: z.object({ users: z.array(z.object({ id: z.string(), username: z.string(), name: z.string() })) }),
  meta: z.object({ result_count: z.number().int(), newest_id: z.string().optional(), oldest_id: z.string().optional(), next_token: z.string().optional() }),
});

export const StartRunRequestSchema = z.object({ idempotencyKey: z.string().trim().min(1).max(200) }).strict();
export const HumanDecisionSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  reviewer: z.string().trim().min(1).max(200),
  comment: z.string().max(5000).default(''),
  candidateRevision: z.string().min(1),
}).strict();

export const DiscoveryGroupSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4000),
  category: z.enum(['too_strong', 'too_weak', 'feels_bad', 'bug', 'other']),
  target: z.string().trim().min(1).max(200).nullable(),
  targetType: z.enum(['unit', 'trait']).nullable(),
  feedbackIds: z.array(z.string().min(1)).min(1),
  existingIssueId: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(50)).max(10),
});
export const DiscoveryOutputSchema = z.object({ groups: z.array(DiscoveryGroupSchema).max(20) }).strict();

export const DesignOutputSchema = z.object({
  hypothesis: z.string().min(1).max(5000),
  evidenceAssessment: z.enum(['supported', 'insufficient_evidence']),
  evidenceRationale: z.string().min(1).max(5000),
  intendedChanges: z.array(z.string().min(1)).min(1).max(20),
  preservedBehavior: z.array(z.string().min(1)).max(20),
  successCriteria: z.array(z.string().min(1)).min(1).max(20),
  checks: z.array(z.object({
    path: z.string().min(1).max(300),
    contents: z.string().min(1).max(20000),
  }).strict()).min(1).max(20),
}).strict();

export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid().nullable(),
  kind: z.enum(['source_evidence', 'baseline', 'design', 'check', 'candidate_diff', 'runner_output', 'simulation', 'evaluation', 'review_packet']),
  logical_path: z.string().nullable(),
  media_type: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size_bytes: z.coerce.number().int().nonnegative(),
  created_at: z.string().datetime({ offset: true }),
});

export const ScenarioSchema = z.object({
  id: z.string().min(1), seed: z.number().int(), provenance: z.enum(['fixture', 'real-game']),
  input: z.record(z.string(), z.unknown()),
}).strict();
export const SimulatorResultSchema = z.object({
  revision: z.string().min(1),
  scenarioId: z.string().min(1),
  seed: z.number().int(),
  provenance: z.enum(['fixture', 'real-game']),
  status: z.enum(['completed', 'timeout', 'failed']),
  metrics: z.object({
    stunExposure: z.number().nonnegative().nullable(),
    executedActions: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative().nullable(),
    outcome: z.enum(['win', 'loss', 'draw', 'timeout', 'unavailable']),
  }).strict(),
  trace: z.array(z.object({ timeMs: z.number().nonnegative(), type: z.string().min(1), data: z.record(z.string(), z.unknown()) }).strict()),
}).strict();

export const RunStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'collecting', 'gating', 'specing', 'implementing', 'verifying', 'interrupted', 'review', 'done', 'failed']),
  workflow_stage: z.string(),
  error: z.string().nullable(),
  baseline_revision: z.string().nullable(),
  candidate_revision: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
}).passthrough();
