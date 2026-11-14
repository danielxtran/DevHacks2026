import { readFile } from 'node:fs/promises';
import { baseConfig } from '../src/config/index';
import { validateSimulationRequest } from '../src/config/validation';
import { compareBalance } from '../src/simulation/balanceComparison';

try {
 const input=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):{changes:[],simulations:100,seed:42};
 const request=validateSimulationRequest(input,baseConfig);
 const result=await compareBalance(request,baseConfig);
 process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
} catch(error) {
 console.error(error instanceof Error?error.message:String(error));
 process.exitCode=1;
}
