import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pool, initDb } from './db';
import { attachUserFromToken, authRouter } from './auth';
import { requireAuth } from './guards';
import { householdsRouter } from './households';
import { recipesRouter } from './recipes';
import { plansRouter } from './plans';
import { aiRouter, resolveProvider } from './ai';
import { shoppingRouter } from './shopping';
import { eventsRouter } from './events';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(attachUserFromToken);

app.get('/api/health', async (_req, res) => {
  const started = Date.now();
  let db = 'ok';
  try {
    await pool.query('SELECT 1');
  } catch {
    db = 'error';
  }
  const ai = resolveProvider();
  res.status(db === 'ok' ? 200 : 503).json({
    status: db === 'ok' ? 'ok' : 'degraded',
    db,
    dbLatencyMs: Date.now() - started,
    ai: { enabled: Boolean(ai), provider: ai?.name ?? 'none', model: ai?.model ?? null },
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.use('/api/auth', authRouter);
// SSE: Token kommt als Query-Parameter, weil EventSource keine Header setzen kann.
app.use('/api/events', eventsRouter);
// Alles ab hier nur mit gültigem Token — die Routen selbst prüfen zusätzlich Haushaltsrechte.
app.use('/api/households', requireAuth, householdsRouter);
app.use('/api/recipes', requireAuth, recipesRouter);
app.use('/api/plans', requireAuth, plansRouter);
app.use('/api/ai', requireAuth, aiRouter);
app.use('/api/shopping', requireAuth, shoppingRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not-found', message: 'Unbekannter Endpunkt.' });
});

const distDir = join(process.cwd(), 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(join(distDir, 'index.html'));
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unhandled', err);
  res.status(500).json({ error: 'internal', message: 'Interner Fehler.' });
});

async function start(): Promise<void> {
  await initDb();
  const ai = resolveProvider();
  app.listen(PORT, () => {
    console.log(`🍲 Meal Planner läuft auf http://localhost:${PORT}`);
    console.log(`   KI: ${ai ? `${ai.name} (${ai.model})` : 'nicht konfiguriert — DEEPSEEK_API_KEY fehlt'}`);
  });
}

start().catch((e) => {
  console.error('Start fehlgeschlagen:', e);
  process.exit(1);
});
