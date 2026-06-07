import { logActivity } from '../lib/agent-bridge.js';

// ─── Configuración ────────────────────────────────────────────────────────────

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_REPO_OWNER || 'axiomaes';
const GITHUB_REPO = process.env.GITHUB_REPO_NAME || 'axioma-creativa-site';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const AXIOMA_API_URL = process.env.AXIOMA_API_URL;
const CONTROL_PLANE_TOKEN = process.env.CONTROL_PLANE_TOKEN;
const MAILCOW_USER = process.env.MAILCOW_USER;
const MAILCOW_PASS = process.env.MAILCOW_PASS;
const MAILCOW_IMAP_HOST = process.env.MAILCOW_IMAP_HOST;
const MAILCOW_SMTP_HOST = process.env.MAILCOW_IMAP_HOST; // mismo host para SMTP
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'ia@axioma-creativa.es';

// RSS feeds de tendencias y referencia sectorial
const RSS_FEEDS = [
  // Moz Blog — SEO de referencia
  'https://moz.com/blog/feed',
  // Search Engine Journal
  'https://www.searchenginejournal.com/feed/',
  // HubSpot Marketing Blog
  'https://blog.hubspot.com/marketing/rss.xml',
  // Neil Patel Blog
  'https://neilpatel.com/blog/feed/',
  // Semrush Blog
  'https://www.semrush.com/blog/feed/',
];

// Contexto de Axioma Creativa para que la IA priorice correctamente
const AXIOMA_CONTEXT = `
Axioma Creativa es una consultora tecnológica española especializada en pymes. 
Sus productos y servicios principales son:
- Axioma CMS: sistema de gestión de contenidos para webs en Astro, sin código
- Ecommerce Headless: tiendas WooCommerce con frontend en Astro, ultrarrápidas
- Axioma Core: CRM modular para gestorías, agencias inmobiliarias y agencias digitales
- Automatización de procesos con IA y n8n
- Desarrollo de aplicaciones a medida y plataformas SaaS

Clientes objetivo: pymes españolas, gestorías, agencias inmobiliarias, tiendas online, emprendedores digitales.
Palabras clave estratégicas: CRM pymes España, migración WordPress Astro, ecommerce headless, automatización procesos pymes, digitalización empresas Madrid.
`;

// ─── Utilidades ───────────────────────────────────────────────────────────────

function parseAIResponse(raw) {
  // Extraer el bloque array [...] de la respuesta
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No array found in AI response');

  let str = match[0];

  // Convertir JS object notation a JSON válido:
  // Añadir comillas dobles a claves sin comillas (ej: title: -> "title":)
  str = str.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

  // Reemplazar comillas simples por dobles en valores string
  // Solo cuando la comilla simple delimita un valor completo
  str = str.replace(/:\s*'([^']*)'/g, ': "$1"');

  // Eliminar comas finales antes de } o ] (trailing commas)
  str = str.replace(/,(\s*[}\]])/g, '$1');

  // Eliminar caracteres de control que rompen JSON.parse
  str = str.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');

  return JSON.parse(str);
}

async function callCloudflareAI(messages) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages })
    }
  );
  if (!res.ok) throw new Error(`Cloudflare AI error: ${res.status}`);
  const data = await res.json();
  return data?.result?.response ?? null;
}

async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AxiomaScout/1.0 (axioma-creativa.es)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const text = await res.text();

    // Extraer títulos del XML/RSS — soporta CDATA, texto plano y entidades HTML
    const titleMatches = text.matchAll(
      /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/gi
    );
    const titles = [];
    for (const match of titleMatches) {
      const title = (match[1] || '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/<[^>]+>/g, '') // eliminar cualquier tag HTML residual
        .trim();
      if (title && title.length > 15 && title.length < 200) {
        titles.push(title);
      }
    }
    // Devolver máximo 10 títulos por feed, saltando el primero (nombre del feed)
    return titles.slice(1, 11);
  } catch (err) {
    console.error(`[seo-agent] Error fetching RSS ${url}:`, err.message);
    return [];
  }
}

async function savePendingTopics(topics) {
  try {
    const res = await fetch(`${AXIOMA_API_URL}/agent-bridge/activity-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-token': CONTROL_PLANE_TOKEN
      },
      body: JSON.stringify({
        agent: 'Axio Scout',
        skill: 'seo-agent',
        action: 'trend-analysis',
        status: 'pending-review',
        detail: { topics, generated_at: new Date().toISOString() }
      })
    });
    if (!res.ok) throw new Error(`Failed to save topics: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[seo-agent] Error saving topics:', err.message);
    return null;
  }
}

async function sendNotificationEmail(topics) {
  try {
    // Importar nodemailer dinámicamente
    const nodemailer = await import('nodemailer');
    
    const transporter = nodemailer.default.createTransporter({
      host: MAILCOW_SMTP_HOST,
      port: 587,
      secure: false,
      auth: { user: MAILCOW_USER, pass: MAILCOW_PASS }
    });

    const topicsHtml = topics.map((t, i) => `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;">
          <strong style="color:#14b884;">#${i + 1} — Puntuación: ${t.score}/10</strong><br/>
          <span style="font-size:16px;font-weight:700;color:#0F172A;">${t.title}</span><br/>
          <span style="font-size:13px;color:#64748b;margin-top:4px;display:block;">${t.rationale}</span><br/>
          <span style="font-size:12px;color:#94a3b8;">Keywords: ${t.keywords.join(', ')}</span>
        </td>
      </tr>
    `).join('');

    await transporter.sendMail({
      from: MAILCOW_USER,
      to: NOTIFY_EMAIL,
      subject: `[Axio Scout] 3 temas SEO propuestos para esta semana — ${new Date().toLocaleDateString('es-ES')}`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head><meta charset="UTF-8"></head>
        <body style="font-family:Arial,sans-serif;background:#f8fafc;padding:20px;">
          <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
            <div style="background:#0F172A;padding:24px;">
              <p style="margin:0;font-size:12px;color:#14b884;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Axio Scout · Agente SEO</p>
              <h1 style="margin:8px 0 0 0;font-size:22px;color:#ffffff;">Temas propuestos para esta semana</h1>
            </div>
            <div style="padding:24px;">
              <p style="color:#64748b;font-size:14px;">El agente ha analizado las tendencias del mercado y propone estos 3 temas. El tema #1 se publicará automáticamente a las 10:00h salvo que lo modifiques en el panel.</p>
              <table style="width:100%;border-collapse:collapse;margin-top:16px;">
                ${topicsHtml}
              </table>
              <div style="margin-top:24px;padding:16px;background:#f0fdf4;border-left:4px solid #14b884;border-radius:4px;">
                <p style="margin:0;font-size:13px;color:#166534;">El artículo del tema #1 se generará y publicará automáticamente a las 10:00h del lunes.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log('[seo-agent] Notification email sent to', NOTIFY_EMAIL);
  } catch (err) {
    console.error('[seo-agent] Error sending notification email:', err.message);
  }
}

async function commitArticleToGitHub(filename, content) {
  const filePath = `src/content/blog/${filename}`;
  const encodedContent = Buffer.from(content).toString('base64');

  // Verificar si el archivo ya existe (para hacer update en vez de create)
  let sha = null;
  try {
    const checkRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'AxiomaScout/1.0'
        }
      }
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      sha = existing.sha;
    }
  } catch (err) {
    // El archivo no existe, es una creación nueva
  }

  const body = {
    message: `feat(blog): [Axio Scout] ${filename.replace('.mdx', '').replace(/-/g, ' ')}`,
    content: encodedContent,
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'AxiomaScout/1.0'
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`GitHub commit failed: ${res.status} — ${error}`);
  }

  return await res.json();
}

// ─── Fase 1: Análisis de tendencias ──────────────────────────────────────────

export async function runTrendAnalysis() {
  console.log('[seo-agent] Starting trend analysis...');

  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    return { status: 'skipped', reason: 'Cloudflare AI not configured' };
  }

  // 1. Recopilar títulos de todos los feeds RSS
  const allTitles = [];
  for (const feedUrl of RSS_FEEDS) {
    const titles = await fetchRSS(feedUrl);
    allTitles.push(...titles);
    console.log(`[seo-agent] Fetched ${titles.length} titles from ${feedUrl}`);
  }

  if (allTitles.length === 0) {
    return { status: 'failed', reason: 'No RSS data available' };
  }

  // 2. Pedir a la IA que analice y priorice temas relevantes para Axioma
  const analysisPrompt = `Eres un experto en SEO y marketing de contenidos para empresas tecnológicas españolas.

CONTEXTO DE LA EMPRESA:
${AXIOMA_CONTEXT}

TITULARES RECIENTES DE TENDENCIAS Y BLOGS DE REFERENCIA:
${allTitles.slice(0, 40).map((t, i) => `${i + 1}. ${t}`).join('\n')}

TAREA:
Analiza estos titulares y propón exactamente 3 temas de artículos de blog para Axioma Creativa.
Los temas deben:
- Estar relacionados con las tendencias actuales del mercado
- Ser relevantes para el cliente objetivo (pymes españolas)
- Tener potencial de posicionamiento SEO en España
- Conectar con los productos/servicios de Axioma Creativa
- Estar orientados al dolor del cliente, no a la tecnología

Responde ÚNICAMENTE con un JSON válido, sin texto adicional, con esta estructura exacta:
[
  {
    "title": "Título del artículo en español",
    "slug": "titulo-del-articulo-en-slug",
    "score": 8,
    "rationale": "Por qué este tema es relevante ahora mismo",
    "keywords": ["keyword1", "keyword2", "keyword3"],
    "target_pain": "El dolor específico del cliente que aborda",
    "internal_link": "/es/servicios/axioma-cms"
  }
]`;

  let topics = [];
  try {
    const aiResponse = await callCloudflareAI([
      { role: 'system', content: 'Eres un experto en SEO para pymes españolas. Respondes ÚNICAMENTE con JSON válido, sin markdown, sin explicaciones.' },
      { role: 'user', content: analysisPrompt }
    ]);

    // Parsear respuesta de la IA — soporta JSON y JS object notation
    topics = parseAIResponse(aiResponse);
    console.log(`[seo-agent] AI proposed ${topics.length} topics`);
  } catch (err) {
    console.error('[seo-agent] Error parsing AI response:', err.message);
    return { status: 'failed', reason: 'AI response parsing failed' };
  }

  // 3. Guardar temas en el backend
  await savePendingTopics(topics);

  // 4. Enviar notificación por email
  await sendNotificationEmail(topics);

  await logActivity({
    agent: 'Axio Scout',
    skill: 'seo-agent',
    action: 'Trend Analysis Completed',
    status: 'success',
    detail: { topics_count: topics.length, feeds_checked: RSS_FEEDS.length }
  }).catch(e => console.error('[seo-agent] Log error:', e));

  return { status: 'success', topics_count: topics.length, topics };
}

// ─── Fase 2: Generación del artículo ─────────────────────────────────────────

export async function runContentGeneration() {
  console.log('[seo-agent] Starting content generation...');

  if (!GITHUB_TOKEN) {
    return { status: 'skipped', reason: 'GitHub token not configured' };
  }

  // 1. Obtener el último análisis pendiente del backend
  let pendingTopics = null;
  try {
    const res = await fetch(`${AXIOMA_API_URL}/agent-bridge/activity-log/latest?skill=seo-agent&action=trend-analysis&status=pending-review`, {
      headers: {
        'Content-Type': 'application/json',
        'x-agent-token': CONTROL_PLANE_TOKEN
      }
    });
    if (res.ok) {
      const data = await res.json();
      pendingTopics = data?.detail?.topics;
    }
  } catch (err) {
    console.error('[seo-agent] Error fetching pending topics:', err.message);
  }

  // Si no hay temas pendientes del backend, salir
  if (!pendingTopics || pendingTopics.length === 0) {
    console.log('[seo-agent] No pending topics found, skipping content generation');
    return { status: 'skipped', reason: 'No pending topics' };
  }

  // 2. Seleccionar el tema con mayor puntuación
  const selectedTopic = pendingTopics.sort((a, b) => b.score - a.score)[0];
  console.log(`[seo-agent] Selected topic: ${selectedTopic.title}`);

  // 3. Generar el artículo completo con la IA
  const articlePrompt = `Eres un redactor experto en marketing de contenidos para empresas tecnológicas españolas.

CONTEXTO DE LA EMPRESA:
${AXIOMA_CONTEXT}

TEMA DEL ARTÍCULO:
- Título: ${selectedTopic.title}
- Dolor del cliente: ${selectedTopic.target_pain}
- Keywords principales: ${selectedTopic.keywords.join(', ')}
- Enlace interno a incluir: ${selectedTopic.internal_link}

INSTRUCCIONES:
Redacta un artículo de blog completo en español para Axioma Creativa.

El artículo debe:
- Empezar con el dolor del cliente en el primer párrafo (no con datos ni definiciones)
- Tener entre 800 y 1200 palabras
- Usar H2 y H3 para estructurar el contenido
- Incluir un ejemplo práctico real o caso de uso
- Terminar con un CTA que enlace a ${selectedTopic.internal_link}
- Tener un tono cercano, honesto y sin jerga técnica innecesaria
- NO mencionar competidores por nombre

Responde ÚNICAMENTE con el contenido del artículo en Markdown, sin frontmatter, sin explicaciones adicionales.`;

  let articleContent = '';
  try {
    articleContent = await callCloudflareAI([
      { role: 'system', content: 'Eres un redactor experto en contenidos para pymes españolas. Escribes en español, de forma clara y orientada al cliente.' },
      { role: 'user', content: articlePrompt }
    ]);
    console.log(`[seo-agent] Article generated: ${articleContent.length} characters`);
  } catch (err) {
    console.error('[seo-agent] Error generating article:', err.message);
    return { status: 'failed', reason: 'Article generation failed' };
  }

  // 4. Construir el frontmatter MDX
  const today = new Date().toISOString();
  const filename = `${selectedTopic.slug}.mdx`;
  const frontmatter = `---
title: "${selectedTopic.title}"
slug: "${selectedTopic.slug}"
description: "${selectedTopic.keywords.slice(0, 3).join(', ')} — Artículo de Axioma Creativa para pymes españolas."
pubDate: "${today}"
tldr: "${selectedTopic.target_pain} — Descubre cómo Axioma Creativa puede ayudarte."
tags: ${JSON.stringify(selectedTopic.keywords)}
author: "Axio Scout · Axioma Creativa"
cover: "/images/blog/${selectedTopic.slug}.png"
ogImage: "/images/blog/${selectedTopic.slug}.png"
---

`;

  const fullArticle = frontmatter + articleContent;

  // 5. Hacer commit al repositorio de GitHub
  try {
    const commitResult = await commitArticleToGitHub(filename, fullArticle);
    console.log(`[seo-agent] Article committed to GitHub: ${filename}`);

    await logActivity({
      agent: 'Axio Scout',
      skill: 'seo-agent',
      action: 'Article Published',
      status: 'success',
      detail: {
        filename,
        title: selectedTopic.title,
        slug: selectedTopic.slug,
        commit_sha: commitResult?.commit?.sha,
        characters: fullArticle.length
      }
    }).catch(e => console.error('[seo-agent] Log error:', e));

    return {
      status: 'success',
      filename,
      title: selectedTopic.title,
      commit_sha: commitResult?.commit?.sha
    };

  } catch (err) {
    console.error('[seo-agent] Error committing to GitHub:', err.message);
    await logActivity({
      agent: 'Axio Scout',
      skill: 'seo-agent',
      action: 'Article Publish Failed',
      status: 'error',
      detail: { error: err.message, title: selectedTopic.title }
    }).catch(() => {});
    return { status: 'failed', reason: err.message };
  }
}
