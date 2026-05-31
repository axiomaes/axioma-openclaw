import { ImapFlow } from 'imapflow';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { groqChat } from '../lib/groq.js';
import { logActivity, createLead } from '../lib/agent-bridge.js';

export async function runMailcowTriage(maxEmails = 5) {
  let processedCount = 0;
  
  if (!process.env.MAILCOW_IMAP_HOST) {
    console.log('[mailcow-triage] IMAP Host not configured, skipping');
    return { status: 'skipped', reason: 'not_configured' };
  }

  const imapConfig = {
    host: process.env.MAILCOW_IMAP_HOST,
    port: parseInt(process.env.MAILCOW_IMAP_PORT) || 993,
    secure: true,
    auth: {
      user: process.env.MAILCOW_USER,
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

        const systemPrompt = `Eres un asistente de triaje de correos para Axioma Creativa. Analiza el correo y redacta una respuesta profesional. Si el correo parece una consulta comercial o un lead interesado en nuestros servicios, DEBES incluir al final de tu respuesta el tag [LEAD: {"name":"Nombre", "email":"email", "phone":"telefono si hay"}].`;
        const userPrompt = `De: ${sender}\nAsunto: ${subject}\n\nContenido original del correo:\n${rawEmailContent}`;

        let aiDraft = "Respuesta autogenerada pendiente (Error de IA o credenciales faltantes).";

        try {
          const groqResponse = await groqChat(systemPrompt, userPrompt);
          if (groqResponse) {
            aiDraft = groqResponse;
          }
        } catch(err) {
          console.error("Error from Groq API:", err.message);
        }

        const leadMatch = aiDraft.match(/\[LEAD:\s*(\{.*?\})\s*\]/);
        let leadCreated = false;

        if (leadMatch) {
          try {
            const leadData = JSON.parse(leadMatch[1]);
            aiDraft = aiDraft.replace(leadMatch[0], '').trim();

            await createLead({
              name: leadData.name || sender.split('@')[0],
              email: leadData.email || sender,
              phone: leadData.phone,
              source: 'email-agent',
              notes: `Generado a partir del correo: ${subject}`
            }).catch(e => console.error("Error creating lead", e));
            leadCreated = true;
          } catch (e) {
            console.error("Error al parsear o crear lead:", e);
          }
        }

        const mailOptions = {
          from: process.env.MAILCOW_USER,
          to: sender,
          subject: `Re: ${subject}`,
          text: aiDraft,
          inReplyTo: msg.envelope.messageId
        };

        const mail = new MailComposer(mailOptions);
        const rawDraftBuffer = await mail.compile().build();

        await client.append('Drafts', rawDraftBuffer, ['\\Draft']);
        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
        
        await logActivity({
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
        }).catch(e => console.error("Error logging activity", e));

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
