import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwindcss()],server:{port:5176,strictPort:true,proxy:{'/api':'http://127.0.0.1:3002'}},preview:{port:4176,strictPort:true}, test:{environment:'node',include:['tests/**/*.test.ts']}});
