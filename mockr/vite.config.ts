import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The developer API runs in server/ (Express, port 4175). In dev, Vite forwards /2 and /api to it,
// so the site and the API share http://localhost:5175. xfwd passes the client IP for rate limiting.
const api = { target: 'http://127.0.0.1:4175', xfwd: true };
const proxy = { '/2': api, '/api': api };

export default defineConfig({
  envDir: '..',
  plugins: [react()],
  server: { port: 5175, strictPort: true, proxy },
  preview: { port: 5175, strictPort: true, proxy },
});
