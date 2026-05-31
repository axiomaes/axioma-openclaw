const { ImapFlow } = require('imapflow');
const MailComposer = require('nodemailer/lib/mail-composer');
const scoutWeb = require('../scout-web/handler'); // Para usar log_activity y conectar con el backend

async function handle(input) {
  const maxEmails = input.maxEmails || 5;
  let processedCount = 0;
  
  const imapConfig = {
    host: process.env.MAILCOW_IMAP_HOST,
    port: parseInt(process.env.MAILCOW_IMAP_PORT) || 993,
    secure: true,
    auth: {
      user: process.env.MAILCOW_USER, // soporte@axioma-creativa.es
      pass: process.env.MAILCOW_PASS
    },
    logger: false
  };

  const client = new ImapFlow(imapConfig);

  try {
    await client.connect();
    
    let lock = await client.getMailboxLock('INBOX');
    try {
      const search = { seen: false };
      const messages = [];
      
      for await (let msg of client.fetch(search, { source: true, uid: true, envelope: true })) {
        messages.push(msg);
        if (messages.length >= maxEmails) break;
      }

      for (const msg of messages) {
        const rawEmailContent = msg.source ? msg.source.toString('utf-8') : 'Contenido no disponible';
        const sender = msg.envelope.from && msg.envelope.from.length > 0 ? msg.envelope.from[0].address : 'Desconocido';
        const subject = msg.envelope.subject || 'Sin Asunto';

        const payload = {
          origin: "openclaw_scout",
          task: "email_triage",
          message: `De: ${sender}\nAsunto: ${subject}\n\nContenido original del correo:\n${rawEmailContent}`,
          history: []
        };

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
            aiDraft = data.result?.response || data.choices?.[0]?.message?.content || "Respuesta generada vacía.";
          }
        }

        // TAREA 7: Si la IA clasifica un email como LEAD (buscamos el tag [LEAD: {...}])
        const leadMatch = aiDraft.match(/\[LEAD:\s*(\{.*?\})\s*\]/);
        let leadCreated = false;

        if (leadMatch) {
          try {
            const leadData = JSON.parse(leadMatch[1]);
            
            // Removemos el tag del borrador para que quede limpio
            aiDraft = aiDraft.replace(leadMatch[0], '').trim();

            // Enviamos el POST al puente de la API (TAREA 7)
            const baseUrl = process.env.AXIOMA_API_URL;
            const apiToken = process.env.CONTROL_PLANE_TOKEN;

            if (baseUrl && apiToken) {
              await fetch(`${baseUrl}/agent-bridge/leads`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-agent-token': apiToken
                },
                body: JSON.stringify({
                  name: leadData.name || sender.split('@')[0],
                  email: leadData.email || sender,
                  phone: leadData.phone,
                  source: 'email-agent',
                  notes: `Generado a partir del correo: ${subject}`
                })
              });
              leadCreated = true;
            }
          } catch (e) {
            console.error("Error al parsear o crear lead:", e);
          }
        }

        const mailOptions = {
          from: process.env.MAILCOW_USER, // Usa el buzón correcto
          to: sender,
          subject: `Re: ${subject}`,
          text: aiDraft,
          inReplyTo: msg.envelope.messageId
        };

        const mail = new MailComposer(mailOptions);
        const rawDraftBuffer = await mail.compile().build();

        await client.append('Drafts', rawDraftBuffer, ['\\Draft']);
        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
        
        // Registrar la actividad usando el scout-web
        await scoutWeb.handle({
          mode: 'log_activity',
          agent: 'Axio Scout',
          skill: 'mailcow-triage',
          action: 'Procesar Email',
          status: 'success',
          detail: { 
            sender, 
            subject, 
            leadCreated,
            draft_length: aiDraft.length 
          }
        });

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
    console.error("Error in mailcow-triage:", error);
    return { status: "failed", error: error.message };
  }
}

module.exports = { handle };
