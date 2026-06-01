import cron from 'node-cron';
import { runSocialPublish } from './skills/social-publish.js';
import { runMailcowTriage } from './skills/mailcow-triage.js';

export function startCron() {
  // Email triage cada 2 horas
  cron.schedule('0 */2 * * *', async () => {
    console.log('[cron] Running mailcow-triage...');
    await runMailcowTriage().catch(e => console.error('[cron] mailcow-triage error:', e));
  });

  // Social publish cada 2 horas (el scheduler interno decide si toca publicar)
  cron.schedule('0 */2 * * *', async () => {
    console.log('[cron] Running social-publish...');
    await runSocialPublish().catch(e => console.error('[cron] social-publish error:', e));
  });

  console.log('[cron] Jobs scheduled. Running...');
  
}
