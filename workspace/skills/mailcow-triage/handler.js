const { ImapFlow } = require('imapflow');
const MailComposer = require('nodemailer/lib/mail-composer');

async function handle(input) {
  const maxEmails = input.maxEmails || 5;
  let processedCount = 0;
  
  // 1. Configuración de conexión usando las variables de entorno
  const imapConfig = {
    host: process.env.MAILCOW_IMAP_HOST,
    port: parseInt(process.env.MAILCOW_IMAP_PORT) || 993,
    secure: true,
    auth: {
      user: process.env.MAILCOW_USER,
      pass: process.env.MAILCOW_PASS
    },
    logger: false // Evitamos ruido en los logs
  };

  const client = new ImapFlow(imapConfig);

  // 2. Lógica de lectura y procesamiento
  try {
    await client.connect();
    
    // Seleccionamos la bandeja de entrada
    let lock = await client.getMailboxLock('INBOX');
    try {
      // Buscar correos no leídos
      const search = { seen: false };
      const messages = [];
      
      for await (let msg of client.fetch(search, { source: true, uid: true, envelope: true })) {
        messages.push(msg);
        if (messages.length >= maxEmails) break;
      }

      for (const msg of messages) {
        // Extraemos el contenido crudo (RFC822) del correo original
        const rawEmailContent = msg.source ? msg.source.toString('utf-8') : 'Contenido no disponible';
        const sender = msg.envelope.from && msg.envelope.from.length > 0 ? msg.envelope.from[0].address : 'Desconocido';
        const subject = msg.envelope.subject || 'Sin Asunto';

        // Preparamos el payload para Cloudflare
        const payload = {
          origin: "openclaw_scout",
          task: "email_triage",
          message: `De: ${sender}\nAsunto: ${subject}\n\nContenido original del correo:\n${rawEmailContent}`,
          history: []
        };

        // Enviar a Cloudflare (Worker / Ollama)
        const cfEndpoint = process.env.CLOUDFLARE_AI_ENDPOINT;
        const cfToken = process.env.CLOUDFLARE_AUTH_TOKEN;
        let aiDraft = "Respuesta autogenerada pendiente (Error de IA o credenciales faltantes).";

        if (cfEndpoint && cfToken) {
          const response = await fetch(cfEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cfToken}`
            },
            body: JSON.stringify(payload)
          });
          
          if (response.ok) {
            const data = await response.json();
            // Soporte para respuestas de Cloudflare AI o compatibles con OpenAI
            aiDraft = data.result?.response || data.choices?.[0]?.message?.content || "Respuesta generada vacía.";
          }
        }

        // Crear el mensaje borrador con Nodemailer MailComposer
        const mailOptions = {
          from: process.env.MAILCOW_USER,
          to: sender,
          subject: `Re: ${subject}`,
          text: aiDraft,
          inReplyTo: msg.envelope.messageId
        };

        const mail = new MailComposer(mailOptions);
        const rawDraftBuffer = await mail.compile().build();

        // Guardar el borrador en la carpeta Drafts
        await client.append('Drafts', rawDraftBuffer, ['\\Draft']);

        // Marcar el original como leído
        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
        
        processedCount++;
      }
    } finally {
      lock.release();
    }
    
    await client.logout();
    
    return { 
      status: "success", 
      processedCount, 
      message: `Procesados y generados ${processedCount} borradores.` 
    };
  } catch (error) {
    return { status: "failed", error: error.message };
  }
}

module.exports = { handle };
