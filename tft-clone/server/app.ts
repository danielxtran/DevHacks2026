import express from 'express';
import cors from 'cors';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ENGINE_FILE_PATHS } from '../src/engine/identity-files';
import { ZodError, z } from 'zod';
import { baseConfig } from '../src/config/index';
import { configIdentifier, simulationRequestSchema, validateConfig, validateSimulationRequest } from '../src/config/validation';
import { compareBalance } from '../src/simulation/balanceComparison';
import { Worker } from 'node:worker_threads';
import type { BalanceComparison, GameConfig, SimulationRequest } from '../src/engine/types';

export type Evaluator=(request:SimulationRequest,config:GameConfig)=>Promise<BalanceComparison>;
export function engineIdentifier():string {
 const hash=createHash('sha256');
 for(const file of ENGINE_FILE_PATHS){hash.update(file);hash.update('\0');hash.update(readFileSync(new URL(`../${file}`, import.meta.url)));hash.update('\0');}
 return hash.digest('hex');
}
const SimulationEnvelopeSchema=simulationRequestSchema.extend({expectedBaselineConfigId:z.string().min(1).max(120),expectedEngineId:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** A worker keeps health/config requests responsive during CPU-heavy batches. */
export function evaluateInWorker(request:SimulationRequest,config:GameConfig):Promise<BalanceComparison>{
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./evaluationWorker.mjs',import.meta.url),{workerData:{request,config}});
  let settled=false;
  const fail=(error:Error)=>{if(settled)return;settled=true;clearTimeout(timeout);reject(error);};
  const timeout=setTimeout(()=>{fail(new Error('Evaluation exceeded the 120 second limit'));void worker.terminate();},120000);
  worker.once('message',(message:{result?:BalanceComparison;error?:string})=>{
   if(settled)return;
   if(message.error){fail(new Error(message.error));return;}
   if(!message.result){fail(new Error('Invalid worker result'));return;}
   settled=true;clearTimeout(timeout);resolve(message.result);
  });
  worker.once('error',fail);
  worker.once('exit',code=>{if(!settled)fail(new Error(`Evaluation worker exited before returning a result (${code})`));});
 });
}
export function createApp(options:{config?:GameConfig;evaluator?:Evaluator}={}){
 const config=validateConfig(options.config??baseConfig);
 const engineId=engineIdentifier();
 const evaluate=options.evaluator??compareBalance;
 const app=express();
 const origins=(process.env.CORS_ORIGINS??'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5176,http://127.0.0.1:5176,http://localhost:4176,http://127.0.0.1:4176').split(',').map(origin=>origin.trim()).filter(Boolean);
 app.use(cors({origin:(origin,cb)=>cb(null,!origin||origins.includes(origin))}));
 app.use(express.json({limit:'64kb',strict:true}));
 app.get('/api/health',(_req,res)=>res.json({status:'ok',service:'mini-tft-balance-lab',baselineConfigId:configIdentifier(config),engineId}));
 app.get('/api/config',(_req,res)=>res.json({...config,baselineConfigId:configIdentifier(config),engineId}));
 let active=0;
 app.post('/api/simulate',async(req,res,next)=>{
  let request:SimulationRequest;
  try{
   const envelope=SimulationEnvelopeSchema.parse(req.body);
   if(envelope.expectedBaselineConfigId!==configIdentifier(config)||envelope.expectedEngineId!==engineId){
    res.status(409).json({error:'Experiment identity changed',baselineConfigId:configIdentifier(config),engineId});return;
   }
   const {expectedBaselineConfigId:_baseline,expectedEngineId:_engine,...input}=envelope;
   request=validateSimulationRequest(input,config);
  }catch(error){res.status(400).json({error:'Invalid simulation request',details:error instanceof ZodError?error.issues:error instanceof Error?error.message:String(error)});return;}
  if(active>=2){res.set('Retry-After','2').status(429).json({error:'Two evaluations are already running. Retry shortly.'});return;}
  active++;
  try{res.json({...await evaluate(request,config),engineId});}catch(error){next(error);}finally{active--;}
 });
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error instanceof SyntaxError){res.status(400).json({error:'Malformed JSON request'});return;}
  if(typeof error==='object'&&error!==null&&'type' in error&&error.type==='entity.too.large'){res.status(413).json({error:'Request body exceeds 64 KB'});return;}
  console.error('Simulation failed:',error);
  res.status(500).json({error:'Simulation failed',details:error instanceof Error?error.message:'Unexpected error'});
 });
 return app;
}
