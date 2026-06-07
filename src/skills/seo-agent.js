import { logActivity } from '../lib/agent-bridge.js';
import * as nodemailerModule from 'nodemailer';
const nodemailer = nodemailerModule.default ?? nodemailerModule;
import * as sharpModule from 'sharp';
const sharp = sharpModule.default ?? sharpModule;
import { runSocialPublish } from './social-publish.js';

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
  // Intentar primero parsear como JSON completo y extraer el primer array
  let str = '';
  
  // Buscar el primer array [...] en la respuesta (puede estar anidado en un objeto)
  const arrayMatch = raw.match(/\[[\s\S]*?\]/s);
  // Buscar también array dentro de objeto {"key": [...]}
  const nestedMatch = raw.match(/:\s*(\[[\s\S]*\])\s*[,}]/s);
  // Buscar array completo más largo (puede abarcar múltiples líneas)
  const fullMatch = raw.match(/\[[\s\S]*\]/s);

  if (fullMatch) {
    str = fullMatch[0];
  } else if (nestedMatch) {
    str = nestedMatch[1];
  } else {
    throw new Error('No array found in AI response');
  }

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
      body: JSON.stringify({ messages, max_tokens: 2048 })
    }
  );
  if (!res.ok) throw new Error(`Cloudflare AI error: ${res.status}`);
  const data = await res.json();
  // Cloudflare devuelve el contenido en choices[0].message.content como string JSON
  return data?.result?.choices?.[0]?.message?.content ?? data?.result?.response ?? null;
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
    const transporter = nodemailer.createTransport({
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

// ─── Generación de imagen Open Graph ─────────────────────────────────────────

async function generateOGImage(title, slug, keywords) {
  try {
    // Truncar título si es muy largo
    const displayTitle = title.length > 80 ? title.substring(0, 77) + '...' : title;
    const keywordText = (keywords || []).slice(0, 3).join(' · ');

    function wrapText(text, maxChars) {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';
      
      words.forEach(word => {
        if ((currentLine + word).length > maxChars) {
          if (currentLine.length > 0) lines.push(currentLine.trim());
          currentLine = word + ' ';
        } else {
          currentLine += word + ' ';
        }
      });
      if (currentLine.length > 0) lines.push(currentLine.trim());
      return lines;
    }

    const escapedTitle = displayTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const titleLines = wrapText(escapedTitle, 35);
    const titleSvg = titleLines.map((line, i) => 
      `<text x="60" y="${190 + i * 65}" font-family="Arial, sans-serif" font-size="52" font-weight="900" fill="#ffffff">${line}</text>`
    ).join('\n  ');

    // SVG template con el diseño de Axioma Creativa
    const svgContent = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0F172A;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#103B30;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Fondo -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  
  <!-- Línea verde superior -->
  <rect x="60" y="60" width="120" height="4" rx="2" fill="#14b884"/>
  
  <!-- Logo / Marca -->
  <text x="60" y="120" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#14b884" letter-spacing="3">AXIOMA CREATIVA</text>
  
  <!-- Título principal -->
  ${titleSvg}
  
  <!-- Keywords -->
  <text x="60" y="510" font-family="Arial, sans-serif" font-size="22" fill="#14b884" font-weight="600">${keywordText}</text>
  
  <!-- URL -->
  <text x="60" y="570" font-family="Arial, sans-serif" font-size="18" fill="#64748b">axioma-creativa.es/es/blog/${slug}</text>
  
  <!-- Punto decorativo verde -->
  <circle cx="1140" cy="570" r="8" fill="#14b884"/>
</svg>`;

    // Convertir SVG a PNG con Sharp
    const pngBuffer = await sharp(Buffer.from(svgContent))
      .png()
      .toBuffer();

    return pngBuffer;
  } catch (err) {
    console.error('[seo-agent] Error generating OG image:', err.message);
    return null;
  }
}

async function commitOGImageToGitHub(slug, pngBuffer) {
  try {
    const filePath = `public/images/blog/${slug}.png`;
    const encodedContent = pngBuffer.toString('base64');

    // Verificar si ya existe
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
    } catch (e) {}

    const body = {
      message: `feat(blog): OG image for ${slug}`,
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
      console.error(`[seo-agent] OG image commit failed: ${error}`);
      return false;
    }

    console.log(`[seo-agent] OG image committed: ${filePath}`);
    return true;
  } catch (err) {
    console.error('[seo-agent] Error committing OG image:', err.message);
    return false;
  }
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
  const keywordsList = Array.isArray(selectedTopic.keywords) 
    ? selectedTopic.keywords.join(', ') 
    : selectedTopic.keywords;

  const articlePrompt = `Eres un redactor experto en SEO y marketing de contenidos para empresas tecnológicas españolas.

CONTEXTO DE LA EMPRESA:
${AXIOMA_CONTEXT}

TEMA DEL ARTÍCULO:
- Título H1 exacto: ${selectedTopic.title}
- Dolor del cliente: ${selectedTopic.target_pain}
- Keywords principales (DEBEN aparecer en el texto): ${keywordsList}
- Enlace interno a incluir: ${selectedTopic.internal_link}

INSTRUCCIONES DE REDACCIÓN:
Redacta un artículo de blog completo en español para Axioma Creativa.

ESTRUCTURA OBLIGATORIA:
1. Primer párrafo: describe el dolor del cliente usando las keywords principales en las primeras 100 palabras
2. H2 "El problema real": explica por qué ocurre este problema en las pymes españolas
3. H2 "Cómo resolverlo": solución práctica con ejemplo concreto
4. H2 "Resultados que puedes esperar": beneficios tangibles con datos o estimaciones realistas
5. Párrafo final de CTA: invita a conocer la solución enlazando a ${selectedTopic.internal_link}

REGLAS SEO OBLIGATORIAS:
- Usar las keywords ${keywordsList} al menos 3 veces cada una a lo largo del texto
- La primera keyword debe aparecer en los primeros 100 caracteres del artículo
- Incluir al menos un H3 dentro de alguna sección H2
- Entre 900 y 1200 palabras en total
- Tono cercano, honesto, sin jerga técnica innecesaria
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

  // 5. Generar imagen Open Graph
  let ogImageCommitted = false;
  const ogImageBuffer = await generateOGImage(
    selectedTopic.title,
    selectedTopic.slug,
    Array.isArray(selectedTopic.keywords) ? selectedTopic.keywords : []
  );

  if (ogImageBuffer) {
    ogImageCommitted = await commitOGImageToGitHub(selectedTopic.slug, ogImageBuffer);
  }

  // 6. Hacer commit del artículo MDX al repositorio de GitHub
  try {
    const commitResult = await commitArticleToGitHub(filename, fullArticle);
    console.log(`[seo-agent] Article committed to GitHub: ${filename}`);

    // 7. Publicar en redes sociales
    // Esperar 30 segundos para que Coolify despliegue el artículo antes de publicar
    console.log('[seo-agent] Waiting 30s for deployment before social publish...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    try {
      const articleUrl = `https://axioma-creativa.es/es/blog/${selectedTopic.slug}`;
      // Generar UUID v4 válido para compatibilidad con Prisma
      const crypto = await import('crypto');
      const forceBlogId = crypto.default?.randomUUID?.() ?? crypto.randomUUID?.() ??
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });

      const socialResult = await runSocialPublish({
        forceBlog: {
          id: forceBlogId,
          title: selectedTopic.title,
          description: selectedTopic.target_pain,
          tldr: `${selectedTopic.title} — ${selectedTopic.target_pain}`,
          slug: selectedTopic.slug,
          url_es: articleUrl,
          og_image: `/images/blog/${selectedTopic.slug}.png`,
          cover: `/images/blog/${selectedTopic.slug}.png`,
        }
      });
      console.log('[seo-agent] Social publish result:', JSON.stringify(socialResult));
    } catch (socialErr) {
      console.error('[seo-agent] Social publish error (non-blocking):', socialErr.message);
    }

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
        characters: fullArticle.length,
        og_image_generated: ogImageCommitted,
        social_publish: true
      }
    }).catch(e => console.error('[seo-agent] Log error:', e));

    return {
      status: 'success',
      filename,
      title: selectedTopic.title,
      commit_sha: commitResult?.commit?.sha,
      og_image: ogImageCommitted,
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
