const https = require('https');

async function handle(input) {
  const { platform, content, imageUrl } = input;
  
  if (!platform || !content) {
    return {
      status: "failed",
      error: "Faltan parámetros obligatorios: 'platform' y 'content' son requeridos."
    };
  }

  const normalizedPlatform = platform.toLowerCase();
  
  if (normalizedPlatform !== 'linkedin' && normalizedPlatform !== 'instagram') {
    return {
      status: "failed",
      error: `Plataforma '${platform}' no soportada. Use 'linkedin' o 'instagram'.`
    };
  }

  // Comprobar modo simulación / tokens por defecto
  const isLinkedinTokenConfigured = process.env.LINKEDIN_ACCESS_TOKEN && 
    !process.env.LINKEDIN_ACCESS_TOKEN.includes('tu_token') && 
    process.env.LINKEDIN_ACCESS_TOKEN.length > 15;
    
  const isInstagramTokenConfigured = process.env.INSTAGRAM_ACCESS_TOKEN && 
    !process.env.INSTAGRAM_ACCESS_TOKEN.includes('tu_token') && 
    process.env.INSTAGRAM_ACCESS_TOKEN.length > 15;

  if (normalizedPlatform === 'linkedin') {
    if (!isLinkedinTokenConfigured) {
      console.log(`[SIMULACIÓN] Publicación en LinkedIn: "${content.substring(0, 100)}..."`);
      return {
        status: "success",
        postId: "sim_li_" + Math.random().toString(36).substring(2, 10),
        message: "Simulación exitosa. Configura LINKEDIN_ACCESS_TOKEN con un token válido de la API para publicar de verdad."
      };
    }

    try {
      // 1. Obtener URN de usuario consultando la API /me
      const profileResponse = await fetch('https://api.linkedin.com/v2/me', {
        headers: {
          'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      if (!profileResponse.ok) {
        const errText = await profileResponse.text();
        throw new Error(`Error obteniendo perfil de LinkedIn (/me): ${profileResponse.statusText} - ${errText}`);
      }

      const profile = await profileResponse.json();
      const authorUrn = `urn:li:person:${profile.id}`;

      // 2. Crear UGC Post
      const ugcPayload = {
        author: authorUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: {
              text: content
            },
            shareMediaCategory: "NONE"
          }
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        }
      };

      // Si hay una imagen, cambiamos la categoría y adjuntamos el medio
      if (imageUrl) {
        ugcPayload.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory = "IMAGE";
        ugcPayload.specificContent["com.linkedin.ugc.ShareContent"].media = [
          {
            status: "READY",
            description: {
              text: "Imagen de Axioma Creativa"
            },
            media: imageUrl,
            title: {
              text: "Axioma Creativa Post"
            }
          }
        ];
      }

      const publishResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(ugcPayload)
      });

      if (!publishResponse.ok) {
        const errText = await publishResponse.text();
        throw new Error(`Error al publicar en LinkedIn (/ugcPosts): ${publishResponse.statusText} - ${errText}`);
      }

      const result = await publishResponse.json();
      return {
        status: "success",
        postId: result.id,
        message: "Publicado en LinkedIn con éxito."
      };
    } catch (error) {
      console.error("Error publicando en LinkedIn:", error);
      return {
        status: "failed",
        error: error.message
      };
    }
  }

  if (normalizedPlatform === 'instagram') {
    if (!isInstagramTokenConfigured) {
      console.log(`[SIMULACIÓN] Publicación en Instagram: "${content.substring(0, 100)}..."`);
      return {
        status: "success",
        postId: "sim_ig_" + Math.random().toString(36).substring(2, 10),
        message: "Simulación exitosa. Configura INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_BUSINESS_ACCOUNT_ID para publicar de verdad."
      };
    }

    const businessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    if (!businessAccountId) {
      return {
        status: "failed",
        error: "Para publicar en Instagram de verdad se necesita definir la variable de entorno INSTAGRAM_BUSINESS_ACCOUNT_ID."
      };
    }

    if (!imageUrl) {
      return {
        status: "failed",
        error: "La API de Instagram Business requiere obligatoriamente una imagen (imageUrl) para crear un contenedor de contenido."
      };
    }

    try {
      // 1. Crear el contenedor multimedia en la Graph API
      const mediaUrl = `https://graph.facebook.com/v19.0/${businessAccountId}/media`;
      const mediaResponse = await fetch(mediaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: content,
          access_token: process.env.INSTAGRAM_ACCESS_TOKEN
        })
      });

      if (!mediaResponse.ok) {
        const errText = await mediaResponse.text();
        throw new Error(`Error creando contenedor multimedia en Instagram: ${mediaResponse.statusText} - ${errText}`);
      }

      const mediaData = await mediaResponse.json();
      const creationId = mediaData.id; // ID del contenedor temporal creado

      // 2. Publicar el contenedor creado
      const publishUrl = `https://graph.facebook.com/v19.0/${businessAccountId}/media_publish`;
      const publishResponse = await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: process.env.INSTAGRAM_ACCESS_TOKEN
        })
      });

      if (!publishResponse.ok) {
        const errText = await publishResponse.text();
        throw new Error(`Error publicando contenedor multimedia en Instagram: ${publishResponse.statusText} - ${errText}`);
      }

      const publishData = await publishResponse.json();
      return {
        status: "success",
        postId: publishData.id,
        message: "Publicado en Instagram con éxito."
      };
    } catch (error) {
      console.error("Error publicando en Instagram:", error);
      return {
        status: "failed",
        error: error.message
      };
    }
  }
}

module.exports = { handle };
