import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The public JSON API runs in server/ (Express, port 4174). In dev, Vite forwards only the API paths to it,
// so the site and the API share http://localhost:5174. These regexes only match .json paths, so React
// routes like /r/PatchworkTFT/post/:id still go to the SPA. xfwd passes the client IP for rate limiting.
const api = { target: 'http://127.0.0.1:4174', xfwd: true };
const proxy = {
  '^/r/[^/]+/(new|hot|top)\\.json': api,
  '^/r/[^/]+/comments/[^/]+\\.json': api,
  '^/r/[^/]+/about\\.json': api,
  '/api': api,
};

export default defineConfig({
  envDir: '..',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5174, strictPort: true, proxy },
});
