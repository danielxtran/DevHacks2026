import { createServer } from 'node:http';
import { Pool } from 'pg';
import { ArtifactStore } from './artifact-store.js';
import { HexlabClient } from './hexlab.js';
import { createApp } from './api.js';
import { loadConfig } from './config.js';
import { DiscoveryAgent } from './discovery.js';
import { reconcileInterruptedRuns } from './repository.js';
import { SourceCollector } from './source-worker.js';
import { WorkerLoop } from './worker.js';
import { WorkflowJobWorker } from './workflow-worker.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 5, application_name: 'devhacks-backend' });
  await reconcileInterruptedRuns(pool);

  const artifacts = new ArtifactStore(pool, config.artifactDir);
  const collector = new SourceCollector(pool, {
    riotditBaseUrl: config.riotditBaseUrl, rBaseUrl: config.rBaseUrl, maxItems: config.maxCollectedItems,
  });
  const discovery = new DiscoveryAgent(pool, config.openaiApiKey, config.openaiModel);
  const hexlab = new HexlabClient(config.hexlabBaseUrl);
  const workflow = new WorkflowJobWorker(pool, artifacts, config.openaiApiKey, config.openaiModel, hexlab);
  const worker = new WorkerLoop(collector, discovery, config.pollIntervalMs, workflow);
  const app = createApp({
    pool, artifacts, baselineRevision: config.baselineRevision, scenarios: config.scenarios,
    sourceConfigured: Boolean(config.riotditBaseUrl && config.rBaseUrl),
    discoveryConfigured: Boolean(config.openaiApiKey && config.openaiModel),
    modelConfigured: Boolean(config.openaiApiKey && config.openaiModel),
    getHexlabConfig: () => hexlab.getConfig(),
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
  console.info(`Backend listening at http://${config.host}:${config.port}`);
  worker.start();

  const shutdown = async () => {
    await worker.stop();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  };
  process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));
}

main().catch((error) => {
  console.error('Backend startup failed:', error);
  process.exitCode = 1;
});
