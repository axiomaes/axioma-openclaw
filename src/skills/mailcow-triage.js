import { ImapFlow } from 'imapflow';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { logActivity, createLead } from '../lib/agent-bridge.js';

// Límite diario de correos procesados para controlar el consumo de Cloudflare AI
const DAILY_EMAIL_LIMIT = parseInt(process.env.EMAIL_DAILY_LIMIT || '10');

export async function runMailcowTriage(maxEmails = DAILY_EMAIL_LIMIT) {
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
        if (messages.length >= maxEmails) {
          console.log(`[mailcow-triage] Daily limit of ${maxEmails} emails reached, stopping.`);
          break;
        }
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

        // Firma HTML corporativa
        const htmlSignature = `
<table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td style="padding:20px 0 0 0;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr><td style="height:3px;background:#14b884;border-radius:2px;"></td></tr>
      </table>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;padding-top:14px;">
        <tr>
          <td style="vertical-align:top;padding-right:20px;border-right:1px solid #e2e8f0;">
            <p style="margin:0 0 2px 0;font-size:16px;font-weight:700;color:#0F172A;letter-spacing:-0.3px;">Equipo de Soporte</p>
            <p style="margin:0 0 10px 0;font-size:12px;color:#14b884;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;">Atención al Cliente &amp; Soporte Técnico</p>
            <p style="margin:0;font-size:11px;color:#64748b;">Axioma Creativa · axioma-creativa.es</p>
          </td>
          <td style="vertical-align:top;padding-left:20px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-bottom:5px;font-size:12px;color:#475569;">
                  <span style="color:#14b884;font-weight:700;">✉</span>&nbsp;
                  <a href="mailto:soporte@axioma-creativa.es" style="color:#0F172A;text-decoration:none;">soporte@axioma-creativa.es</a>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:5px;font-size:12px;color:#475569;">
                  <span style="color:#14b884;font-weight:700;">🌐</span>&nbsp;
                  <a href="https://axioma-creativa.es" style="color:#14b884;text-decoration:none;">axioma-creativa.es</a>
                </td>
              </tr>
              <tr>
                <td style="font-size:11px;color:#94a3b8;">Madrid, España</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:14px;">
        <tr>
          <td style="background:#f8fafc;border-left:3px solid #14b884;padding:8px 12px;border-radius:0 4px 4px 0;">
            <p style="margin:0;font-size:11px;color:#64748b;font-style:italic;">Este correo puede contener información confidencial. Si lo has recibido por error, por favor notifícanos y elimínalo.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

        // Versión HTML completa: cuerpo de la IA + firma
        const htmlBody = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;padding:20px 0;">
    ${aiDraft.split('\n').map(line => line.trim() ? `<p style="margin:0 0 12px 0;font-size:14px;color:#1e293b;line-height:1.6;">${line}</p>` : '').join('\n')}
  </div>
  <div style="max-width:520px;">
    ${htmlSignature}
  </div>
</body>
</html>`;

        // Subir borrador al IMAP con la respuesta generada por el backend
        const mailOptions = {
          from: process.env.MAILCOW_USER,
          to: sender,
          subject: `Re: ${subject}`,
          text: aiDraft,
          html: htmlBody,
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
