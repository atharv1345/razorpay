/**
 * One-command demo reset: seed + insights + idempotent preemptive predictions.
 * Usage: npm run demo:reset
 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = pathToFileURL(
  path.join(__dirname, '../backend/src/dev/resetDemo.js')
).href;

const { resetDemoScenario } = await import(mod);
const summary = await resetDemoScenario();
console.log(summary.message);
if (summary.seedLog) summary.seedLog.forEach((l) => console.log(l));
