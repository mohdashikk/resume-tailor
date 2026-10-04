import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { handleAIRequest } from './api/ai.js';

export default defineConfig(({ mode }) => {
  const serverEnv = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      {
        name: 'local-ai-endpoint',
        configureServer(server) {
          server.middlewares.use('/api/ai', async (req, res) => {
            if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed.' })); return; }
            let raw = '';
            req.on('data', (chunk) => { raw += chunk; });
            req.on('end', async () => {
              try {
                const result = await handleAIRequest(JSON.parse(raw || '{}'), serverEnv);
                res.statusCode = result.status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result.body));
              } catch { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Invalid request body.' })); }
            });
          });
        },
      },
    ],
    server: { port: 5173 },
    test: { environment: 'jsdom', globals: true },
  };
});
