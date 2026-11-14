import { parentPort, workerData } from 'node:worker_threads';
import { tsImport } from 'tsx/esm/api';
try {
 const {compareBalance}=await tsImport('../src/simulation/balanceComparison.ts',import.meta.url);
 const result=await compareBalance(workerData.request,workerData.config);
 parentPort.postMessage({result});
} catch(error) {parentPort.postMessage({error:error instanceof Error?error.message:String(error)});}
