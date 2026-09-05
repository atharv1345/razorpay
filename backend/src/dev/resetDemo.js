/**
 * Programmatic demo reset — used by POST /api/dev/reset-demo and npm run demo:reset
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { generateInsights } from '../insights/generateInsights.js';
import { runPredictions } from '../prediction/predictRisk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../../..');

function runSeed() {
  return new Promise((resolve, reject) => {
    const script = path.join(root, 'scripts/seed-demo-scenario.js');
    const child = spawn(process.execPath, [script, '--reset'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(out || `seed exited ${code}`));
    });
  });
}

export async function resetDemoScenario() {
  // Clear bandit exploration state for identical demo re-runs
  db.prepare('DELETE FROM bandit_state').run();
  db.prepare('DELETE FROM batch_progress').run();

  const log = await runSeed();
  await generateInsights();
  // Single authoritative preemptive pass (idempotent — safe if seed already predicted)
  runPredictions({ sendPreemptive: true });
  // Second scan must not duplicate nudges
  runPredictions({ sendPreemptive: true });

  return {
    message: 'Demo scenario reset',
    seedLog: log.trim().split('\n').slice(-3),
  };
}

export default { resetDemoScenario };
