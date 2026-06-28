// Envio de e-mail via SMTP (nodemailer).
// Configure no Render: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_ADMIN
// Se não configurado, apenas loga no console (não derruba o servidor).
const nodemailer = require('nodemailer');

const cfg = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || process.env.SMTP_USER || 'tialindasac@tialinda.com.br',
  admin: process.env.MAIL_ADMIN || 'tialindasac@tialinda.com.br'
};

let transporter = null;
if (cfg.host && cfg.user && cfg.pass) {
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  console.log('[mailer] SMTP configurado:', cfg.host + ':' + cfg.port);
} else {
  console.log('[mailer] SMTP não configurado (defina SMTP_HOST/USER/PASS). E-mails serão apenas logados.');
}

async function send({ to, subject, html, text }) {
  if (!transporter) {
    console.log('[mailer:DRY-RUN] to=' + to + ' subject=' + subject);
    return { dryRun: true };
  }
  try {
    const info = await transporter.sendMail({
      from: '"Tia Linda Enxovais – SAC" <' + cfg.from + '>',
      to, subject, html, text
    });
    console.log('[mailer] enviado:', info.messageId, '→', to);
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error('[mailer] falha:', e.message);
    return { ok: false, error: e.message };
  }
}

function brl(n) { return 'R$ ' + Number(n).toFixed(2).replace('.', ','); }

function orderHtml(order, items) {
  const rows = items.map(i =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${i.name} × ${i.qty}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${brl(i.price * i.qty)}</td></tr>`
  ).join('');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h2 style="color:#9a3b2c">Tia Linda Enxovais</h2>
    <p>Olá, <strong>${order.customer_name}</strong>!</p>
    <p>Recebemos seu pedido <strong>#${order.id}</strong> e ele já está em processamento.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #333">Item</th>
      <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #333">Valor</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td style="padding:6px 8px;text-align:right">Subtotal:</td><td style="padding:6px 8px;text-align:right">${brl(order.subtotal)}</td></tr>
        <tr><td style="padding:6px 8px;text-align:right">Frete:</td><td style="padding:6px 8px;text-align:right">${brl(order.shipping)}</td></tr>
        <tr><td style="padding:6px 8px;text-align:right;font-weight:bold">Total:</td><td style="padding:6px 8px;text-align:right;font-weight:bold">${brl(order.total)}</td></tr>
      </tfoot>
    </table>
    <p><strong>Pagamento:</strong> ${order.payment || '—'}</p>
    <p><strong>Código de rastreio:</strong> ${order.tracking_code || '(será gerado em breve)'}</p>
    <p><strong>Entrega em:</strong> ${order.address || ''}, ${order.city || ''} - ${order.state || ''} · CEP ${order.cep || ''}</p>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <p style="font-size:13px;color:#666">Dúvidas? WhatsApp <a href="https://wa.me/5513996554822">(13) 99655-4822</a> ou responda este e-mail.</p>
    <p style="font-size:12px;color:#999">Tia Linda Enxovais · Santos/SP · www.tialinda.com.br</p>
  </body></html>`;
}

function adminHtml(order, items) {
  const rows = items.map(i => `<li>${i.name} × ${i.qty} — ${brl(i.price * i.qty)}</li>`).join('');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <h2>Novo pedido #${order.id}</h2>
    <p><strong>Cliente:</strong> ${order.customer_name} (${order.email}, ${order.phone || 's/ tel'})</p>
    <p><strong>Endereço:</strong> ${order.address || ''}, ${order.city || ''}-${order.state || ''}, CEP ${order.cep || ''}</p>
    <p><strong>Pagamento:</strong> ${order.payment} · <strong>Total:</strong> ${brl(order.total)} (frete ${brl(order.shipping)})</p>
    <p><strong>Itens:</strong></p>
    <ul>${rows}</ul>
    <p><a href="https://tialinda.onrender.com/admin/pedido/${order.id}">Ver no painel administrativo →</a></p>
  </body></html>`;
}

async function sendOrderConfirmation(order, items) {
  if (order.email) {
    await send({
      to: order.email,
      subject: `Pedido #${order.id} confirmado — Tia Linda Enxovais`,
      html: orderHtml(order, items),
      text: `Olá ${order.customer_name}! Seu pedido #${order.id} foi recebido. Total: ${brl(order.total)}. Acompanhe em https://tialinda.onrender.com/rastrear`
    });
  }
  await send({
    to: cfg.admin,
    subject: `[Tia Linda] Novo pedido #${order.id} — ${order.customer_name} — ${brl(order.total)}`,
    html: adminHtml(order, items),
    text: `Novo pedido #${order.id} de ${order.customer_name} (${order.email}). Total ${brl(order.total)}.`
  });
}

module.exports = { send, sendOrderConfirmation };
