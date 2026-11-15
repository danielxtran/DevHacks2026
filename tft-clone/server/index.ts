import { createApp, evaluateInWorker } from './app';
const port=Number(process.env.PORT??3002);
createApp({evaluator:evaluateInWorker}).listen(port,'127.0.0.1',()=>console.log(`Balance API listening at http://localhost:${port}`));
