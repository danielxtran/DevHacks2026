import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { ENGINE_FILE_PATHS } from './src/engine/identity-files';
const root=dirname(fileURLToPath(import.meta.url));
const engineHash=createHash('sha256');
for(const file of ENGINE_FILE_PATHS){engineHash.update(file);engineHash.update('\0');engineHash.update(readFileSync(resolve(root,file)));engineHash.update('\0');}
const engineId=engineHash.digest('hex');
const apiPort=Number(process.env.PORT??3002);
export default defineConfig({define:{__HEXLAB_ENGINE_ID__:JSON.stringify(engineId)},plugins:[react(),tailwindcss()],server:{port:5176,strictPort:true,proxy:{'/api':`http://127.0.0.1:${apiPort}`}},preview:{port:4176,strictPort:true}, test:{environment:'node',include:['tests/**/*.test.ts']}});
