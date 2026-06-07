import cron from 'node-cron';
import { runSocialPublish } from './skills/social-publish.js';
import { runMailcowTriage } from './skills/mailcow-triage.js';
import { runTrendAnalysis, runContentGeneration } from './skills/seo-agent.js';

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

  // SEO Agent — Análisis de tendencias cada lunes a las 8:00
  cron.schedule('0 8 * * 1', async () => {
    console.log('[cron] Running seo-agent trend-analysis...');
    await runTrendAnalysis().catch(e => console.error('[cron] seo-agent trend-analysis error:', e));
  });

  // SEO Agent — Generación de artículo cada lunes a las 10:00
  cron.schedule('0 10 * * 1', async () => {
    console.log('[cron] Running seo-agent content-generation...');
    await runContentGeneration().catch(e => console.error('[cron] seo-agent content-generation error:', e));
  });

  console.log('[cron] Jobs scheduled. Running...');
}
