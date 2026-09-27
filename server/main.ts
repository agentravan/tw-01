import 'dotenv/config';
import { createServer } from 'node:http';
import { handle, init, controlRoom, runAutonomousCycle } from './app.js';
import { startDailyReportScheduler } from '../reports/scheduler.js';

// Local / VPS / Docker entry point. Scheduled jobs run only here; serverless deployments have no long-running process.
await init();
const server = createServer((req, res) => { void handle(req, res); });
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  controlRoom.ensureSeed().catch(error => console.error('TW-01 control room seed error', error));
  startDailyReportScheduler();
  console.log(`TW-01 listening on http://localhost:${port}`);
  if (process.env.TW01_AUTO_RUN !== 'false') {
    const hours = Math.max(1, Number(process.env.TW01_CYCLE_HOURS || 6));
    runAutonomousCycle().then(result => console.log('TW-01 initial autonomous cycle', result)).catch(error => console.error('TW-01 initial cycle error', error));
    setInterval(() => runAutonomousCycle().catch(error => console.error('TW-01 cycle error', error)), hours * 60 * 60 * 1000);
    console.log(`TW-01 autonomous cycle enabled every ${hours}h`);
  }
});
