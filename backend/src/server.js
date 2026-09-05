import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import { initSchema } from './db/index.js';
import api from './routes/api.js';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

initSchema();

const app = express();

const frontendUrl = (process.env.FRONTEND_URL || '').trim();
const isProd = process.env.NODE_ENV === 'production';

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser / same-origin tools (no Origin header)
      if (!origin) return callback(null, true);

      if (!frontendUrl) {
        // Dev default: reflect request origin only when not production
        if (!isProd) return callback(null, true);
        console.error('CORS blocked: FRONTEND_URL is not set in production');
        return callback(new Error('CORS misconfigured'));
      }

      const allowed = frontendUrl.split(',').map((s) => s.trim()).filter(Boolean);
      if (allowed.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.get('/', (_req, res) => {
  res.json({
    name: 'Recovery Yield Optimizer',
    track: 'AI Revenue Recovery (Track 3)',
  });
});

app.use('/api', api);

// Generic error handler — never expose stack traces or filesystem paths
app.use((err, _req, res, _next) => {
  console.error(err?.stack || err);
  const isCors = String(err?.message || '').toLowerCase().includes('cors');
  res.status(isCors ? 403 : 500).json({
    error: isCors ? 'cors_denied' : 'internal_error',
  });
});

const port = config.PORT;
app.listen(port, () => {
  console.log(`RYO backend on http://localhost:${port}`);
  console.log('Track 3: AI Revenue Recovery — not fraud detection');
  if (isProd && !frontendUrl) {
    console.warn('WARNING: FRONTEND_URL unset in production — browser CORS will fail');
  }
});

export default app;
