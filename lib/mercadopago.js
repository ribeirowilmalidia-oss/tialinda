// Integração com Mercado Pago Checkout Pro via HTTP API.
// Docs: https://www.mercadopago.com.br/developers/pt/reference/preferences/_checkout_preferences/post
//
// Configurar no Render:
//   MP_ACCESS_TOKEN=APP_USR-...  (produção)
//   SITE_URL=https://tialinda.com.br

const TOKEN = process.env.MP_ACCESS_TOKEN || '';
const SITE_URL = (process.env.SITE_URL || 'https://tialinda.com.br').replace(/\/$/, '');

if (TOKEN) {
  console.log('[mp] Mercado Pago configurado (token ' + TOKEN.length + ' chars)');
} else {
  console.log('[mp] MP_ACCESS_TOKEN não definido — pagamento em modo DRY-RUN');
}

// Cria uma preferência de pagamento e retorna { init_point, id }.
// order = { id, customer_name, email, phone, cep, address, city, state, subtotal, shipping, total, payment }
// items = [{ name, qty, price, id }]
async function createPreference(order, items) {
  if (!TOKEN) {
    console.log('[mp:DRY-RUN] preferência não criada — retornando URL fake');
    return { init_point: SITE_URL + '/pedido/' + order.id + '?dry=1', id: 'dry-run', dryRun: true };
  }

  const body = {
    external_reference: String(order.id),
    items: items.map(i => ({
      id: String(i.id),
      title: i.name.substring(0, 250),
      quantity: i.qty,
      unit_price: Number(i.price),
      currency_id: 'BRL'
    })),
    shipments: {
      cost: Number(order.shipping || 0),
      mode: 'not_specified'
    },
    payer: {
      name: order.customer_name || '',
      email: order.email || '',
      phone: order.phone ? { area_code: '', number: String(order.phone).replace(/\D/g,'') } : undefined,
      address: {
        zip_code: (order.cep || '').replace(/\D/g,''),
        street_name: order.address || '',
        street_number: ''
      }
    },
    back_urls: {
      success: SITE_URL + '/pedido/' + order.id + '/retorno?status=success',
      pending: SITE_URL + '/pedido/' + order.id + '/retorno?status=pending',
      failure: SITE_URL + '/pedido/' + order.id + '/retorno?status=failure'
    },
    auto_return: 'approved',
    notification_url: SITE_URL + '/webhook/mercadopago',
    statement_descriptor: 'TIA LINDA',
    payment_methods: {
      installments: 3,
      default_installments: 1
    }
  };

  try {
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.init_point) {
      console.log('[mp] preferência criada para pedido #' + order.id + ' → ' + json.id);
      return { init_point: json.init_point, id: json.id };
    }
    console.error('[mp] falha HTTP', res.status, '→', JSON.stringify(json));
    return { error: json.message || ('HTTP ' + res.status) };
  } catch (e) {
    console.error('[mp] erro:', e.message);
    return { error: e.message };
  }
}

// Consulta um pagamento pelo ID
async function getPayment(paymentId) {
  if (!TOKEN) return null;
  try {
    const res = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
      headers: { 'Authorization': 'Bearer ' + TOKEN },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('[mp] getPayment erro:', e.message);
    return null;
  }
}

// Mapeia status do MP → status interno
function mapStatus(mpStatus) {
  switch (mpStatus) {
    case 'approved':   return 'pago';
    case 'pending':    return 'aguardando_pagamento';
    case 'in_process': return 'aguardando_pagamento';
    case 'authorized': return 'pago';
    case 'rejected':   return 'recusado';
    case 'cancelled':  return 'cancelado';
    case 'refunded':   return 'devolvido';
    default:           return 'pendente';
  }
}

module.exports = { createPreference, getPayment, mapStatus };
