import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, evaluateInWorker } from '../server/app';
import { baseConfig } from '../src/config';
import { applyPatch, configIdentifier, validateConfig } from '../src/config/validation';
import { compareBalance } from '../src/simulation/balanceComparison';

const app=createApp();
const patch={changes:[{type:'unit',id:'yasuo',stat:'attackDamage',value:20}],simulations:100,seed:42};
describe('configuration validation',()=>{
 it('applies only allowed stats without mutating baseline',()=>{
  const modified=applyPatch(baseConfig,patch.changes as any);
  expect(modified.champions.yasuo.attackDamage).toBe(20);
  expect(baseConfig.champions.yasuo.attackDamage).toBe(25);
  expect(configIdentifier(modified)).not.toBe(configIdentifier(baseConfig));
 });
 it.each([
  [{type:'unit',id:'unknown',stat:'hp',value:5}],
  [{type:'unit',id:'yasuo',stat:'hp',value:-1}],
  [{type:'item',id:'recurve_bow',stat:'range',value:3}],
  [{type:'unit',id:'yasuo',stat:'range',value:1.5}],
  [{type:'unit',id:'yasuo',stat:'hp',value:Infinity}],
  [{type:'monster',id:'krug',stat:'attackSpeed',value:0}],
  [{type:'unit',id:'__proto__',stat:'hp',value:100}],
  [{type:'unit',id:'yasuo',stat:'name',value:3}],
 ])('rejects invalid changes %j',(change)=>{
  expect(()=>applyPatch(baseConfig,[change] as any)).toThrow();
 });
 it('validates the full baseline config',()=>{expect(validateConfig(baseConfig)).toEqual(baseConfig);});
});
describe('simulation API',()=>{
 it('returns health and baseline configuration',async()=>{
  const health=await request(app).get('/api/health').expect(200);
  const config=await request(app).get('/api/config').expect(200);
  expect(health.body.status).toBe('ok');
  expect(config.body.champions.yasuo.attackDamage).toBe(25);
  expect(config.body.baselineConfigId).toBe(health.body.baselineConfigId);
 });
 it('evaluates a real patch end to end and reproduces metrics',async()=>{
  const first=await request(app).post('/api/simulate').send(patch).expect(200);
  const second=await request(app).post('/api/simulate').send(patch).expect(200);
  expect(first.body.simulations).toBe(100);
  expect(first.body.appliedChanges).toEqual(patch.changes);
  expect(first.body.before.games).toBe(100);
  expect(first.body.before).toEqual(second.body.before);
  expect(first.body.after).toEqual(second.body.after);
  expect(first.body.before.champions.yasuo.samples).toBeGreaterThan(0);
  expect(first.body.after.champions.yasuo.averageDamageDealt).not.toBe(first.body.before.champions.yasuo.averageDamageDealt);
  expect(first.body.before.champions.yasuo.confidenceInterval).toHaveLength(2);
 },20000);
 it('supports real PvE clear-rate output',async()=>{
  const response=await request(app).post('/api/simulate').send({...patch,mode:'pve'}).expect(200);
  expect(response.body.mode).toBe('pve');
  expect(response.body.before.clearRate).toBeGreaterThanOrEqual(0);
  expect(response.body.before.clearRate).toBeLessThanOrEqual(100);
 });
 it.each([
  {...patch,simulations:999999}, {...patch,seed:-1}, {...patch,seed:1.5}, {...patch,changes:[{type:'unit',id:'yasuo',stat:'attackDamage',value:'20'}]}, {...patch,changes:[{type:'unit',id:'missing',stat:'hp',value:10}]}, {...patch,changes:[],execute:'code'}, {...patch,changes:[{type:'item',id:'bf_sword',stat:'hp',value:10}]},
  {...patch,changes:[{type:'unit',id:'yasuo',stat:'hp',value:-1},{type:'unit',id:'yasuo',stat:'hp',value:115}]},
  {...patch,changes:[{type:'item',id:'recurve_bow',stat:'attackSpeed',value:6},{type:'item',id:'recurve_bow',stat:'attackSpeed',value:0.2}]},
 ])('rejects invalid requests',async(body)=>{await request(app).post('/api/simulate').send(body).expect(400);});
 it('rejects malformed JSON',async()=>{await request(app).post('/api/simulate').set('Content-Type','application/json').send('{oops').expect(400);});
 it('rejects oversized bodies',async()=>{await request(app).post('/api/simulate').send({...patch,padding:'x'.repeat(66000)}).expect(413);});
 it('keeps health responsive, limits concurrency, and releases completed slots',async()=>{
  let started=0;
  let acknowledgeStarted!:()=>void;
  let release!:()=>void;
  const bothStarted=new Promise<void>(resolve=>{acknowledgeStarted=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const gatedApp=createApp({evaluator:async(input,config)=>{
   started++;
   if(started===2)acknowledgeStarted();
   await gate;
   return compareBalance(input,config);
  }});
  const first=request(gatedApp).post('/api/simulate').send(patch).then(response=>response);
  const second=request(gatedApp).post('/api/simulate').send(patch).then(response=>response);
  await bothStarted;
  try{
   await request(gatedApp).get('/api/health').expect(200);
   const busy=await request(gatedApp).post('/api/simulate').send(patch).expect(429);
   expect(busy.headers['retry-after']).toBe('2');
  }finally{release();}
  const completed=await Promise.all([first,second]);
  expect(completed.map(response=>response.status)).toEqual([200,200]);
  await request(gatedApp).post('/api/simulate').send(patch).expect(200);
 },10000);
 it('releases a concurrency slot after evaluation failures',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  let calls=0;
  const failingApp=createApp({evaluator:async(input,config)=>{
   calls++;
   if(calls<=2)throw new Error('Controlled evaluation failure');
   return compareBalance(input,config);
  }});
  try{
   await request(failingApp).post('/api/simulate').send(patch).expect(500);
   await request(failingApp).post('/api/simulate').send(patch).expect(500);
   await request(failingApp).post('/api/simulate').send(patch).expect(200);
  }finally{log.mockRestore();}
 });
 it('allows only configured local CORS origins',async()=>{
  const allowed=await request(app).get('/api/health').set('Origin','http://localhost:5173');
  expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  const denied=await request(app).get('/api/health').set('Origin','https://untrusted.example');
  expect(denied.headers['access-control-allow-origin']).toBeUndefined();
 });
 it('runs the production worker-backed endpoint',async()=>{
  const workerApp=createApp({evaluator:evaluateInWorker});
  const response=await request(workerApp).post('/api/simulate').send(patch).expect(200);
  expect(response.body.before.games).toBe(100);
  expect(response.body.after.champions.yasuo.samples).toBeGreaterThan(0);
 },20000);
});
