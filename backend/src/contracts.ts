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
  id: z.string().min(1), name: z.string().min(1), parent_id: z.string().min(1), author: z.string(), body: z.string(),
  score: z.number().int(), created_utc: z.number().int(),
}).superRefine((comment, ctx) => {
  if (comment.name !== `t1_${comment.id}`) ctx.addIssue({ code: 'custom', message: 'Comment name must match its t1_ ID.' });
});
const RedditPostSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), title: z.string(), selftext: z.string(), author: z.string(),
  score: z.number().int(), created_utc: z.number().int(), num_comments: z.number().int().nonnegative(),
  permalink: z.string(), subreddit: z.string(), comments: z.array(RedditCommentSchema),
}).superRefine((post, ctx) => {
  if (post.name !== `t3_${post.id}`) ctx.addIssue({ code: 'custom', message: 'Post name must match its t3_ ID.' });
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
  id: z.string().min(1), text: z.string(), author_id: z.string().min(1), created_at: z.string().datetime({ offset: true }),
  conversation_id: z.string().min(1),
  public_metrics: z.object({ like_count: z.number().int(), retweet_count: z.number().int(), reply_count: z.number().int(), quote_count: z.number().int() }),
  referenced_tweets: z.array(z.object({ type: z.literal('replied_to'), id: z.string().min(1) })).max(1),
});
const RSearchPageSchema = z.object({
  data: z.array(TweetSchema).min(1),
  includes: z.object({ users: z.array(z.object({ id: z.string(), username: z.string(), name: z.string() })) }),
  meta: z.object({ result_count: z.number().int().positive(), newest_id: z.string().optional(), oldest_id: z.string().optional(), next_token: z.string().optional() }),
}).superRefine((page, ctx) => {
  if (page.meta.result_count !== page.data.length) {
    ctx.addIssue({ code: 'custom', message: 'result_count must equal the number of tweets in data.' });
  }
});
const RSearchEmptySchema = z.object({
  meta: z.object({ result_count: z.literal(0) }).strict(),
}).strict();
export const RSearchSchema = z.union([RSearchPageSchema, RSearchEmptySchema]);
export type RTweet = z.infer<typeof TweetSchema>;
export type RSearchPage = z.infer<typeof RSearchSchema>;

const ActorSchema = z.string().trim().min(1).max(100);
export const DeveloperIdSchema = z.enum(['dev', 'jun', 'marco', 'ana', 'priya']);
export const IssueMetadataRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  actor: ActorSchema,
  developer: DeveloperIdSchema.nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
}).strict().refine(({ developer, title, tags }) => developer !== undefined || title !== undefined || tags !== undefined, {
  message: 'At least one issue field must be provided.',
});
export const IssueCommentRequestSchema = z.object({ expectedRevision: z.number().int().positive(), actor: ActorSchema, text: z.string().trim().min(1).max(5000) }).strict();
export const IssueDismissRequestSchema = z.object({ expectedRevision: z.number().int().positive(), actor: ActorSchema, reason: z.string().trim().min(1).max(2000) }).strict();
export const IssueRestoreRequestSchema = z.object({ expectedRevision: z.number().int().positive(), actor: ActorSchema }).strict();
export const IssueMergeRequestSchema = z.object({
  expectedRevision: z.number().int().positive(), expectedCanonicalRevision: z.number().int().positive(),
  actor: ActorSchema, canonicalIssueId: z.string().uuid(),
}).strict();
export const StartRunRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200), actor: ActorSchema,
}).strict();

const HexlabKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/).refine(id => !['constructor', 'prototype', '__proto__'].includes(id));
const HexlabStatsSchema = z.object({
  hp: z.number().finite().min(1).max(10000), attackDamage: z.number().finite().min(0).max(1000),
  attackSpeed: z.number().finite().min(0.1).max(5), armor: z.number().finite().min(0).max(500),
  range: z.number().int().min(1).max(4),
});
export const HexlabConfigSchema = z.object({
  id: z.string().min(1).max(100), baselineConfigId: z.string().min(1).max(120),
  engineId: z.string().regex(/^[a-f0-9]{64}$/),
  champions: z.record(HexlabKeySchema, z.object({ name: z.string().min(1).max(80), role: z.string().min(1).max(40), portrait: z.string().regex(/^[A-Za-z0-9]+$/).optional(), ...HexlabStatsSchema.shape }).strict()).refine(value => Object.keys(value).length >= 3),
  items: z.record(HexlabKeySchema, z.object({ name: z.string().min(1).max(80), attackDamage: z.number().finite().min(0).max(1000), attackSpeed: z.number().finite().min(0).max(5), armor: z.number().finite().min(0).max(500) }).strict()),
  monsters: z.record(HexlabKeySchema, z.object({ name: z.string().min(1).max(80), role: z.string().min(1).max(40), portrait: z.string().regex(/^[A-Za-z0-9]+$/).optional(), ...HexlabStatsSchema.shape }).strict()).refine(value => Object.hasOwn(value, 'krug')),
}).strict();
export const NumericChangeSchema = z.object({
  type: z.enum(['unit', 'item', 'monster']), id: HexlabKeySchema,
  stat: z.enum(['hp', 'attackDamage', 'attackSpeed', 'armor', 'range']), value: z.number().finite(),
}).strict();
export const NumericPatchSchema = z.array(NumericChangeSchema).max(100);
export const NumericDesignOutputSchema = z.object({
  markdown: z.string().trim().min(1).max(50000),
  hypothesis: z.string().trim().min(1).max(5000),
  evidenceAssessment: z.enum(['supported', 'insufficient_evidence']),
  evidenceRationale: z.string().trim().min(1).max(5000),
  evidenceIds: z.array(z.string().min(1)).max(100),
  intendedChanges: z.array(z.string().trim().min(1).max(1000)).max(20),
  preservedBehavior: z.array(z.string().trim().min(1).max(1000)).max(20),
  successCriteria: z.array(z.string().trim().min(1).max(1000)).max(20),
  numericPatch: NumericPatchSchema.nullable(),
  unsupportedReason: z.string().max(2000).nullable(),
}).strict().superRefine((output, ctx) => {
  if ((!output.numericPatch || output.numericPatch.length === 0) && !output.unsupportedReason?.trim()) {
    ctx.addIssue({ code: 'custom', message: 'A missing numeric patch must explain why the proposal is unsupported.' });
  }
});
const RunRevisionSchema = z.object({ expectedRevision: z.number().int().positive(), actor: ActorSchema });
export const SpecRevisionRequestSchema = RunRevisionSchema.extend({
  idempotencyKey: z.string().trim().min(1).max(200), expectedVersion: z.number().int().positive(),
  prompt: z.string().trim().min(1).max(5000),
}).strict();
export const SpecEditRequestSchema = RunRevisionSchema.extend({
  expectedVersion: z.number().int().positive(), baseSpecVersionId: z.string().uuid().optional(),
  markdown: z.string().max(50000).optional(), numericPatch: NumericPatchSchema.optional(),
  note: z.string().max(2000).default(''),
}).strict().refine(({ markdown, numericPatch, baseSpecVersionId }) => markdown !== undefined || numericPatch !== undefined || baseSpecVersionId !== undefined, {
  message: 'Provide markdown or a numeric patch to save a version.',
});
export const SpecApprovalRequestSchema = RunRevisionSchema.extend({
  idempotencyKey: z.string().trim().min(1).max(200), specVersionId: z.string().uuid(), baselineConfigId: z.string().min(1).max(120),
  engineId: z.string().regex(/^[a-f0-9]{64}$/), numericPatch: NumericPatchSchema,
  seed: z.number().int().min(0).max(4294967295), mode: z.enum(['pvp', 'pve']),
  battles: z.union([z.literal(100), z.literal(1000), z.literal(5000), z.literal(10000)]),
}).strict();
export const SpecRejectionRequestSchema = RunRevisionSchema.extend({
  specVersionId: z.string().uuid(), reason: z.string().trim().min(1).max(2000),
}).strict();
export const SimulationQueueRequestSchema = RunRevisionSchema.extend({
  idempotencyKey: z.string().trim().min(1).max(200), battles: z.union([z.literal(100), z.literal(1000), z.literal(5000), z.literal(10000)]),
}).strict();
export const SpecRetryRequestSchema = RunRevisionSchema.extend({ idempotencyKey: z.string().trim().min(1).max(200) }).strict();
export const SimulationRetryRequestSchema = RunRevisionSchema.extend({ idempotencyKey: z.string().trim().min(1).max(200) }).strict();
export const ReturnToDevelopmentRequestSchema = RunRevisionSchema.extend({ reason: z.string().trim().min(1).max(2000) }).strict();
export const NumericDecisionRequestSchema = RunRevisionSchema.extend({
  decision: z.enum(['accept', 'reject']), comment: z.string().max(5000).default(''),
  specVersionId: z.string().uuid(), simulationId: z.string().uuid(),
}).strict();
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
