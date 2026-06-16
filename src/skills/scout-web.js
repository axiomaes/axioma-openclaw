import { logActivity } from '../lib/agent-bridge.js';
import { sendAlert } from '../lib/notifier.js';

const SITE_URL = process.env.SITE_URL || 'https://axioma-creativa.es';

// Páginas críticas que siempre se verifican, con independencia del sitemap
const CRITICAL_PATHS = [
  '/es/',
  '/es/servicios/',
  '/es/blog/',
  '/es/nosotros/',
  '/es/contacto/',
  '/es/axioma-core/',
  '/es/paginas-web/',
  '/es/programa-digitalizacion-2026/',
  '/api/blog-metadata.json',
  '/sitemap-index.xml',
  '/robots.txt',
];

async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'AxiomaScout/1.0 Health Check' },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);
    const ok = res.status >= 200 && res.status < 400;
    return { url, status: res.status, ok };
  } catch (err) {
    return { url, status: 0, ok: false, error: err.message };
  }
}

async function parseSitemapUrls(sitemapUrl) {
  try {
    const res = await fetch(sitemapUrl, {
      headers: { 'User-Agent': 'AxiomaScout/1.0 Health Check' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const text = await res.text();
    return [...text.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
      .map(m => m[1].trim())
      .filter(url => url.startsWith('http'));
  } catch {
    return [];
  }
}

export async function runScoutWeb() {
  console.log('[scout-web] Starting health check...');

  // 1. Build URL list: critical paths + sitemap pages
  const criticalUrls = CRITICAL_PATHS.map(p => `${SITE_URL}${p}`);

  const sitemapIndexUrls = await parseSitemapUrls(`${SITE_URL}/sitemap-index.xml`);

  const sitemapPageUrls = [];
  for (const sitemapUrl of sitemapIndexUrls.slice(0, 5)) {
    if (sitemapUrl.endsWith('.xml')) {
      const pageUrls = await parseSitemapUrls(sitemapUrl);
      sitemapPageUrls.push(...pageUrls);
    }
  }

  // Deduplicate, prioritise critical paths, cap at 40 total
  const allUrls = [...new Set([...criticalUrls, ...sitemapPageUrls])].slice(0, 40);
  console.log(`[scout-web] Checking ${allUrls.length} URLs...`);

  const results = { ok: [], broken: [] };

  for (const url of allUrls) {
    const result = await checkUrl(url);
    if (result.ok) {
      results.ok.push(url);
    } else {
      results.broken.push({ url, status: result.status, error: result.error });
      console.warn(`[scout-web] BROKEN: ${url} → ${result.status || result.error}`);
    }
    // Small delay to avoid hammering the server
    await new Promise(r => setTimeout(r, 300));
  }

  const hasBroken = results.broken.length > 0;
  const status = hasBroken ? 'warning' : 'success';

  // 2. Log results to backend
  await logActivity({
    agent: 'Axio Scout',
    skill: 'scout-web',
    action: 'Health Check',
    status,
    detail: {
      checked: allUrls.length,
      ok: results.ok.length,
      broken: results.broken.length,
      broken_urls: results.broken,
      checked_at: new Date().toISOString()
    }
  }).catch(e => console.error('[scout-web] Log error:', e));

  // 3. Send email alert if any pages are broken
  if (hasBroken) {
    const brokenRows = results.broken
      .map(r => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;word-break:break-all;">${r.url}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#dc2626;font-weight:700;white-space:nowrap;">
            ${r.status ? `HTTP ${r.status}` : r.error || 'Error'}
          </td>
        </tr>`)
      .join('');

    await sendAlert(
      `[Axio Scout] ⚠️ ${results.broken.length} página(s) con errores — ${new Date().toLocaleDateString('es-ES')}`,
      `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
        <div style="background:#0F172A;padding:20px 24px;border-radius:8px 8px 0 0;">
          <p style="margin:0;font-size:11px;color:#14b884;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Axio Scout · Health Check</p>
          <h2 style="color:#fff;margin:6px 0 0;font-size:20px;">Páginas con error detectadas</h2>
        </div>
        <div style="padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
          <p style="color:#64748b;margin:0 0 16px;">
            Se han detectado <strong style="color:#dc2626;">${results.broken.length} URL(s) con error</strong>
            al revisar <strong>${allUrls.length} páginas</strong> de axioma-creativa.es.
          </p>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">URL</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;">Estado</th>
              </tr>
            </thead>
            <tbody>${brokenRows}</tbody>
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">
            OK: ${results.ok.length} · Errores: ${results.broken.length} · Total revisadas: ${allUrls.length}
          </p>
        </div>
      </div>`
    ).catch(e => console.error('[scout-web] Alert email error:', e.message));
  }

  console.log(`[scout-web] Done. ${results.ok.length} OK, ${results.broken.length} broken.`);
  return {
    status,
    checked: allUrls.length,
    ok: results.ok.length,
    broken: results.broken.length,
    broken_urls: results.broken
  };
}
