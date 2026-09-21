import { formatRange } from './slots';

// Sends an email using whichever service is set up in .env.local:
//
//   GMAIL_USER + GMAIL_APP_PASSWORD  -> sends through that Gmail account
//   RESEND_API_KEY                   -> sends through Resend
//   neither                          -> prints the email in the terminal
//
// Gmail wins if both are set, so you can practise on Gmail now and switch to
// Resend with his own domain later just by changing .env.local.
//
// Never throws: a failed email must not break a booking.
export async function sendEmail(message) {
  if (!message.to) return { ok: false, error: 'No recipient' };

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return sendWithGmail(message);
  if (process.env.RESEND_API_KEY) return sendWithResend(message);
  return preview(message);
}

function preview({ to, subject, text, replyTo }) {
  const line = '─'.repeat(64);
  console.log(
    `\n${line}\n📧  EMAIL PREVIEW (not sent — no email service set up)\n` +
    `To:       ${to}\n` +
    (replyTo ? `Reply-To: ${replyTo}\n` : '') +
    `Subject:  ${subject}\n${line}\n${text}\n${line}\n`
  );
  return { ok: true, previewed: true };
}

// ---- Gmail ----------------------------------------------------------------

let gmailTransport = null;

async function getGmailTransport() {
  if (gmailTransport) return gmailTransport;
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    throw new Error('The nodemailer package isn’t installed. Run: npm install nodemailer');
  }
  gmailTransport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER.trim(),
      // Google shows app passwords in groups of four with spaces; drop them.
      pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''),
    },
  });
  return gmailTransport;
}

// Gmail's own error messages are cryptic; translate the common ones.
function explainGmailError(e) {
  const text = String((e && (e.response || e.message)) || e);
  if (/535|Username and Password not accepted|BadCredentials/i.test(text)) {
    return 'Gmail rejected the login. Check GMAIL_USER is the full Gmail address, and that GMAIL_APP_PASSWORD is an App Password (16 letters), not the normal Gmail password.';
  }
  if (/Application-specific password required|534/i.test(text)) {
    return 'Gmail needs an App Password here, not the normal password. Create one at myaccount.google.com/apppasswords.';
  }
  if (/Daily user sending limit|550.*limit/i.test(text)) {
    return 'This Gmail account has hit its daily sending limit. It resets within 24 hours.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout/i.test(text)) {
    return 'Couldn’t connect to Gmail. Check the internet connection.';
  }
  return text;
}

async function sendWithGmail({ to, subject, html, text, replyTo }) {
  try {
    const transport = await getGmailTransport();
    const name = process.env.EMAIL_FROM_NAME || 'Bookings';
    await transport.sendMail({
      from: `"${name.replace(/"/g, '')}" <${process.env.GMAIL_USER.trim()}>`,
      to,
      subject,
      text,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
    return { ok: true };
  } catch (e) {
    const error = explainGmailError(e);
    console.error('Email failed (Gmail):', error);
    // A bad login shouldn't stay cached after .env.local is fixed.
    gmailTransport = null;
    return { ok: false, error };
  }
}

// ---- Resend ---------------------------------------------------------------

async function sendWithResend({ to, subject, html, text, replyTo }) {
  const from = process.env.EMAIL_FROM || 'Bookings <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('Email failed (Resend):', res.status, body);
      let message = `Resend returned ${res.status}`;
      try { message = JSON.parse(body).message || message; } catch {}
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch (e) {
    console.error('Email failed (Resend):', e.message);
    return { ok: false, error: e.message };
  }
}

// Client-supplied text goes into HTML emails, so it has to be escaped —
// otherwise someone could put markup or links into the email he receives.
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prettyDate(key) {
  return new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function when(request) {
  const time = request.start_time && request.end_time
    ? `, ${formatRange({ start: request.start_time, end: request.end_time })}`
    : '';
  return `${prettyDate(request.date)}${time}`;
}

function siteUrl() {
  return (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// Shared wrapper so every email looks the same, in the site's colours.
function layout(heading, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f2e6c9;font-family:Georgia,serif;color:#1c130d;">
<div style="max-width:520px;margin:0 auto;padding:32px 24px;">
  <h1 style="font-style:italic;font-weight:600;font-size:24px;color:#7c2532;margin:0 0 18px;">${heading}</h1>
  <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">${bodyHtml}</div>
</div></body></html>`;
}

function detailRows(rows) {
  return `<table style="border-collapse:collapse;width:100%;margin:14px 0;">${rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b5a3e;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;">${esc(v)}</td></tr>`)
    .join('')}</table>`;
}

// ---------------------------------------------------------------------------
// The one automated email: telling him a request has come in
// ---------------------------------------------------------------------------

// To the saxophonist: a new request needs his attention.
export function newRequestForMusician(request, profile) {
  const subject = `New booking request — ${when(request)}`;
  const adminLink = `${siteUrl()}/admin`;
  const text =
`New booking request

When:    ${when(request)}
Name:    ${request.name}
Phone:   ${request.phone || '—'}
Email:   ${request.email}
Event:   ${request.type}

${request.message ? 'Message:\n' + request.message + '\n\n' : ''}Call ${request.name} to talk it through, then approve or decline it here: ${adminLink}`;

  const html = layout('New booking request',
    detailRows([
      ['When', when(request)],
      ['Name', request.name],
      ['Phone', request.phone],
      ['Email', request.email],
      ['Event', request.type],
    ]) +
    (request.phone ? `<p><a href="tel:${esc(request.phone.replace(/[^\d+]/g, ''))}" style="display:inline-block;background:#3c5643;color:#f2e6c9;padding:10px 18px;text-decoration:none;border-radius:3px;">Call ${esc(request.name)}</a></p>` : '') +
    (request.message ? `<p style="background:#e9d9b2;padding:12px 14px;border-left:3px solid #c1912f;white-space:pre-wrap;">${esc(request.message)}</p>` : '') +
    `<p><a href="${esc(adminLink)}" style="display:inline-block;background:#7c2532;color:#f2e6c9;padding:10px 18px;text-decoration:none;border-radius:3px;">Approve or decline</a></p>`
  );

  return { subject, text, html };
}

// Where his notifications go: NOTIFY_EMAIL if set, else his public profile email.
export function musicianAddress(profile) {
  return process.env.NOTIFY_EMAIL || (profile && profile.email) || null;
}