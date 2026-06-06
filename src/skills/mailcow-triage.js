import { ImapFlow } from 'imapflow';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
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
        const senderName = msg.envelope.from && msg.envelope.from.length > 0
          ? `${msg.envelope.from[0].name || sender.split('@')[0]}`
          : sender.split('@')[0];
        const subject = msg.envelope.subject || 'Sin Asunto';

        // Fallback por si el backend falla
        let aiDraft = 'Gracias por contactar con Axioma Creativa. Hemos recibido tu mensaje y nos pondremos en contacto contigo en menos de 48 horas.';
        let leadCreated = false;

        // Llamar al backend — crea el lead, guarda la actividad y genera la respuesta con IA
        try {
          const backendResult = await createLead({
            name: senderName,
            email: sender,
            phone: null,
            source: 'email-agent',
            notes: rawEmailContent,  // Enviamos el cuerpo real del correo
          });

          // El backend ahora devuelve { lead, aiReply, notes_saved }
          if (backendResult && backendResult.aiReply) {
            aiDraft = backendResult.aiReply;
          }

          if (backendResult && backendResult.lead) {
            leadCreated = true;
          }

        } catch (e) {
          console.error('[mailcow-triage] Error llamando al backend:', e.message);
          // El fallback ya está definido arriba — continuamos con el borrador genérico
        }

        // Subir borrador al IMAP con la respuesta generada por el backend
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
            notes_saved: true,
            draft_length: aiDraft.length,
            source: 'backend-cloudflare-ai'
          }
        }).catch(e => console.error('[mailcow-triage] Error logging activity:', e));

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
