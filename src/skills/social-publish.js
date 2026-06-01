import { shouldPublishNow, markPublished } from '../lib/scheduler.js';
import { groqChat } from '../lib/groq.js';
import { getPendingBlogs, markPublished as bridgeMarkPublished, logActivity } from '../lib/agent-bridge.js';

async function generateCopy(blog, platform) {
  let instruction = "";
  if (platform === 'linkedin') instruction = "copy profesional 150-200 palabras, CTA al URL del blog, hashtags sector tech";
  if (platform === 'instagram') instruction = "copy visual 80-100 palabras, emojis moderados, 5 hashtags relevantes";
  if (platform === 'facebook') instruction = "copy conversacional 100-130 palabras, pregunta al final para engagement";

  const systemPrompt = `Eres el community manager de Axioma Creativa, agencia digital española especializada en desarrollo web, automatización e inteligencia artificial para empresas B2B.
Tono: profesional pero cercano. Idioma: español.`;

  const userPrompt = `Escribe un post para ${platform} sobre este artículo: 
Título: ${blog.title}
Descripción: ${blog.description}
TL;DR: ${blog.tldr}
URL: ${blog.url_es || blog.slug}
Requisito específico: ${instruction}

Responde ÚNICAMENTE con el texto del post listo para publicar.
NO incluyas explicaciones, preguntas, notas, ni frases como "si quieres más hashtags".
NO incluyas comillas al inicio o final del texto.
El texto debe terminar con los hashtags, sin ninguna frase adicional después.`;

  try {
    const aiText = await groqChat(systemPrompt, userPrompt);
    if (aiText) return aiText;
  } catch (err) {
    console.error('Error in AI generate:', err.message);
  }
  
  return `¡Nuevo artículo! ${blog.title} - ${blog.url_es || blog.slug}`;
}

async function publishReal(platform, content, imageUrl, articleUrl, articleTitle) {
  if (platform === 'linkedin') {
    const personId = process.env.LINKEDIN_PERSON_ID;
    if (!personId) throw new Error("Missing LINKEDIN_PERSON_ID");
    const authorUrn = `urn:li:person:${personId}`;

    let assetUrn = null;
    const fullImageUrl = imageUrl ? (imageUrl.startsWith('http') ? imageUrl : `https://axioma-creativa.es${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`) : null;

    if (fullImageUrl) {
      try {
        const registerRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            registerUploadRequest: {
              recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
              owner: authorUrn,
              serviceRelationships: [{
                relationshipType: "OWNER",
                identifier: "urn:li:userGeneratedContent"
              }]
            }
          })
        });
        
        if (registerRes.ok) {
          const registerData = await registerRes.json();
          const uploadMechanism = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'];
          const uploadUrl = uploadMechanism.uploadUrl;
          assetUrn = registerData.value.asset;

          const imageRes = await fetch(fullImageUrl);
          if (imageRes.ok) {
            const arrayBuffer = await imageRes.arrayBuffer();
            const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
            
            const uploadRes = await fetch(uploadUrl, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
                'Content-Type': contentType
              },
              body: arrayBuffer
            });
            
            if (!uploadRes.ok) {
              console.error("LinkedIn image upload failed:", await uploadRes.text());
              assetUrn = null;
            }
          } else {
            console.error("Failed to download image:", await imageRes.text());
            assetUrn = null;
          }
        } else {
          console.error("LinkedIn registerUpload failed:", await registerRes.text());
        }
      } catch (err) {
        console.error("Error handling LinkedIn image:", err.message);
        assetUrn = null;
      }
    }

    const ugcPayload = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: assetUrn ? {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: content },
          shareMediaCategory: 'IMAGE',
          media: [{
            status: 'READY',
            description: { text: articleTitle || 'Nuevo artículo en el blog' },
            media: assetUrn,
            title: { text: articleTitle || 'Nuevo artículo en el blog' }
          }]
        }
      } : {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: content },
          shareMediaCategory: 'ARTICLE',
          media: [{
            status: 'READY',
            originalUrl: articleUrl || 'https://axioma-creativa.es',
            title: { text: articleTitle || 'Nuevo artículo en el blog' }
          }]
        }
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    };

    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(ugcPayload)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error("Error publishing to LinkedIn: " + errText);
    }
    const result = await res.json();
    return result.id;
  }

  if (platform === 'instagram') {
    const bizId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!bizId) throw new Error("Missing INSTAGRAM_BUSINESS_ACCOUNT_ID");

    const fullImageUrl = imageUrl ? (imageUrl.startsWith('http') ? imageUrl : `https://axioma-creativa.es${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`) : null;

    if (!fullImageUrl) {
      console.log("[SKIP] Instagram requiere imagen, blog sin cover.");
      return "SKIPPED_NO_IMAGE";
    }

    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${bizId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: fullImageUrl, caption: content, access_token: token })
    });
    if (!mediaRes.ok) throw new Error("Error creating Instagram media: " + await mediaRes.text());
    const mediaData = await mediaRes.json();

    const pubRes = await fetch(`https://graph.facebook.com/v18.0/${bizId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: mediaData.id, access_token: token })
    });
    if (!pubRes.ok) throw new Error("Error publishing Instagram media: " + await pubRes.text());
    const pubData = await pubRes.json();
    return pubData.id;
  }

  if (platform === 'facebook') {
    const pageId = process.env.FACEBOOK_PAGE_ID;
    const token = process.env.FACEBOOK_ACCESS_TOKEN;
    if (!pageId) throw new Error("Missing FACEBOOK_PAGE_ID");

    const fullImageUrl = imageUrl ? (imageUrl.startsWith('http') ? imageUrl : `https://axioma-creativa.es${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`) : null;

    if (fullImageUrl) {
      const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: fullImageUrl,
          message: content,
          access_token: token
        })
      });
      if (!res.ok) throw new Error("Error publishing Facebook photo: " + await res.text());
      const data = await res.json();
      return data.id;
    } else {
      const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link: articleUrl || 'https://axioma-creativa.es',
          message: content,
          access_token: token
        })
      });
      if (!res.ok) throw new Error("Error publishing Facebook link: " + await res.text());
      const data = await res.json();
      return data.id;
    }
  }

  return `sim_real_${platform}_${Date.now()}`;
}

export async function runSocialPublish() {
  if (!shouldPublishNow()) {
    console.log("Scheduler says not to publish now.");
    return { status: 'skipped', reason: 'not_scheduled' };
  }

  const pending = {
    linkedin: [],
    instagram: [],
    facebook: []
  };

  try {
    pending.linkedin = await getPendingBlogs('linkedin').catch(() => []);
    pending.instagram = await getPendingBlogs('instagram').catch(() => []);
    pending.facebook = await getPendingBlogs('facebook').catch(() => []);
  } catch (err) {
    console.error("Error fetching pending blogs:", err);
  }

  if (!pending.linkedin?.length && !pending.instagram?.length && !pending.facebook?.length) {
    console.log("No pending blogs to publish.");
    await logActivity({
      agent: 'Axio Scout',
      skill: 'social-publish',
      action: 'Check pending blogs',
      status: 'success',
      detail: { reason: 'no_content' }
    }).catch(e => console.error("Error logging activity", e));
    return { status: 'skipped', reason: 'no_content' };
  }

  const platforms = ['linkedin', 'instagram', 'facebook'];
  let publishedCount = 0;

  for (const platform of platforms) {
    if (!pending[platform] || pending[platform].length === 0) continue;
    
    const blog = pending[platform][0];
    const copy = await generateCopy(blog, platform);
    
    const tokenEnv = platform === 'facebook' ? 'FACEBOOK_ACCESS_TOKEN' : `${platform.toUpperCase()}_ACCESS_TOKEN`;
    const token = process.env[tokenEnv];
    const isConfigured = token && !token.includes('tu_token') && token.length > 15;

    let activityStatus = 'simulated';
    let postIdExterno = `sim_${platform}_${Math.random().toString(36).substring(2, 10)}`;

    if (isConfigured) {
      try {
        postIdExterno = await publishReal(platform, copy, blog.og_image || blog.cover, blog.url_es || blog.slug, blog.title);
        activityStatus = 'success';
        console.log(`[REAL] Publicado en ${platform}: ${postIdExterno}`);
      } catch (err) {
        activityStatus = 'error';
        console.error(`Error publishing real to ${platform}:`, err.message);
      }
    } else {
      console.log(`[SIMULACIÓN] Publicación en ${platform}: "${copy.substring(0, 50)}..."`);
    }

    if (activityStatus === 'success' || activityStatus === 'simulated') {
      const extraId = platform === 'linkedin' ? postIdExterno : undefined;
      await bridgeMarkPublished(blog.id, platform, extraId).catch(e => console.error("Error marking published", e));
    }

    await logActivity({
      agent: 'Axio Scout',
      skill: 'social-publish',
      action: `Publish to ${platform}`,
      ref_id: blog.id,
      ref_type: 'blog',
      status: activityStatus,
      detail: { post_id_externo: postIdExterno, copy_generado: copy, blog_url: blog.url_es || blog.slug }
    }).catch(e => console.error("Error logging activity", e));

    publishedCount++;
  }

  if (publishedCount > 0) {
    markPublished();
  }

  return { status: "success", publishedCount };
}
