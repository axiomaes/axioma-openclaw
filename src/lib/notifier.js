import * as nodemailerModule from 'nodemailer';
const nodemailer = nodemailerModule.default ?? nodemailerModule;

const DEFAULT_TO = process.env.NOTIFY_EMAIL || 'ia@axioma-creativa.es';

export async function sendAlert(subject, html) {
  const host = process.env.MAILCOW_SMTP_HOST || process.env.MAILCOW_IMAP_HOST;
  const port = parseInt(process.env.MAILCOW_SMTP_PORT || '587');
  const user = process.env.MAILCOW_USER;
  const pass = process.env.MAILCOW_PASS;

  if (!host || !user || !pass) {
    console.warn('[notifier] SMTP not configured — skipping alert:', subject);
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from: user,
      to: DEFAULT_TO,
      subject,
      html
    });

    console.log('[notifier] Alert sent:', subject);
    return true;
  } catch (err) {
    console.error('[notifier] Failed to send alert:', err.message);
    return false;
  }
}
