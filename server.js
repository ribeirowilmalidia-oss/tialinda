// Tia Linda E-commerce - Express + MySQL (TiDB)
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const pool = require('./db');
const payments = require('./lib/payments');
const mailer = require('./lib/mailer');

// Chave PIX e dados do recebedor (Mercado Pago - Wilma Lidia Ribeiro)
const PIX_KEY     = process.env.PIX_KEY     || 'ee9e688b-ee8f-4c7d-86e9-7abc7d971cc6';
const PIX_NAME    = process.env.PIX_NAME    || 'Wilma Lidia Ribeiro';
const PIX_CITY    = process.env.PIX_CITY    || 'Santos';
// Token do Mercado Pago (defina via variável de ambiente para habilitar boleto real)
const MP_TOKEN    = process.env.MP_ACCESS_TOKEN || '';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(cookieParser());

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tialinda2026';
const SHIPPING_FREE_THRESHOLD = 199;

// ---------- Categories ----------
const CATEGORIES = [
  { slug: 'cama',        name: 'Cama',        icon: 'M3 10h18v8H3z M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3' },
  { slug: 'mesa',        name: 'Mesa',        icon: 'M3 10h18M5 10v8M19 10v8M7 14h10' },
  { slug: 'banho',       name: 'Banho',       icon: 'M4 11h16v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4z M8 11V6a2 2 0 0 1 4 0' },
  { slug: 'perfumaria',  name: 'Perfumaria',  icon: 'M9 3h6v3H9z M7 6h10l1 4v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9z' },
  { slug: 'cosmeticos',  name: 'Cosméticos',  icon: 'M9 3h6v6H9z M8 9h8v12H8z' }
];

// ---------- DB ----------
async function migrate() {
  await pool.execute(`CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(220) NOT NULL UNIQUE,
    category VARCHAR(40) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    image_url VARCHAR(500),
    featured TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(120) NOT NULL,
    email VARCHAR(160) NOT NULL,
    phone VARCHAR(30),
    cep VARCHAR(12),
    address VARCHAR(300),
    city VARCHAR(80),
    state VARCHAR(5),
    subtotal DECIMAL(10,2) NOT NULL,
    shipping DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    payment VARCHAR(20),
    status VARCHAR(30) NOT NULL DEFAULT 'pendente',
    tracking_code VARCHAR(40),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    qty INT NOT NULL
  )`);

  const [rows] = await pool.execute('SELECT COUNT(*) AS c FROM products');
  if (Number(rows[0].c) === 0) await seed();
}

async function seed() {
  const items = [
    // Cama
    ['Jogo de Cama Queen Floral 4 peças', 'cama', 'Percal 200 fios, toque macio, estampa floral exclusiva. Inclui lençol, fronhas e fronha decorativa.', 189.90, 25, 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=600', 1],
    ['Edredom Casal Plumasul Bege', 'cama', 'Edredom dupla face, microfibra antialérgica, enchimento 250g/m².', 249.00, 18, 'https://images.unsplash.com/photo-1631049552240-59c37f38802b?w=600', 1],
    ['Kit 2 Fronhas Acetinadas Rosê', 'cama', 'Cetim 100% poliéster, antifrizz, ideal para cabelo e pele.', 59.90, 60, 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=600', 0],
    ['Protetor de Colchão Impermeável Solteiro', 'cama', 'Forração 100% algodão com camada impermeável.', 79.90, 30, 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=600', 0],

    // Mesa
    ['Toalha de Mesa Retangular Linho 8 lugares', 'mesa', 'Linho misto, bordas acabadas, lavável em máquina.', 139.00, 22, 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=600', 1],
    ['Jogo Americano Bambu (4 unidades)', 'mesa', 'Conjunto rústico em bambu trançado, antiderrapante.', 79.90, 40, 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600', 0],
    ['Kit 6 Guardanapos Tecido Algodão', 'mesa', 'Algodão premium, costura francesa, várias cores.', 49.90, 80, 'https://images.unsplash.com/photo-1493770348161-369560ae357d?w=600', 0],
    ['Caminho de Mesa Bordado Provençal', 'mesa', 'Bordado à mão, 1,80m, ideal para almoços especiais.', 99.00, 15, 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600', 0],

    // Banho
    ['Toalha de Banho Gigante Felpuda', 'banho', '100% algodão egípcio, 90x150cm, alta absorção.', 89.90, 50, 'https://images.unsplash.com/photo-1600369671236-e74521d4b6ad?w=600', 1],
    ['Roupão Atoalhado Plush Adulto', 'banho', 'Microfibra plush, capuz, bolsos laterais. Tamanhos M/G/GG.', 199.00, 20, 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=600', 1],
    ['Tapete Antiderrapante Box Banheiro', 'banho', 'Memory foam, base emborrachada, 60x40cm.', 69.90, 35, 'https://images.unsplash.com/photo-1564540583246-934409427776?w=600', 0],
    ['Kit 4 Toalhas de Rosto Bordadas', 'banho', 'Algodão felpudo, monograma bordado disponível.', 79.90, 45, 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600', 0],

    // Perfumaria
    ['Perfume Floral Romance 100ml', 'perfumaria', 'Notas de jasmim, peônia e baunilha. Fixação 8h.', 159.90, 28, 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=600', 1],
    ['Colônia Cítrica Sunshine 75ml', 'perfumaria', 'Bergamota, limão siciliano e cedro. Refrescante.', 119.00, 32, 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=600', 0],
    ['Body Splash Frutas Vermelhas 200ml', 'perfumaria', 'Spray corporal hidratante com aroma marcante.', 49.90, 70, 'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=600', 0],
    ['Sachê Perfumado Lavanda (3 unidades)', 'perfumaria', 'Para gavetas e armários, fragrância dura 90 dias.', 29.90, 100, 'https://images.unsplash.com/photo-1595425970377-c9703cf48b6d?w=600', 0],

    // Cosméticos
    ['Hidratante Corporal Karité 400ml', 'cosmeticos', 'Manteiga de karité + óleo de amêndoas. Pele macia 24h.', 69.90, 55, 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=600', 1],
    ['Kit Batom Matte Nude (3 cores)', 'cosmeticos', 'Longa duração, vegano, alta cobertura.', 89.00, 40, 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600', 1],
    ['Máscara Facial Argila Rosa 60g', 'cosmeticos', 'Limpeza profunda, controle de oleosidade.', 39.90, 80, 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600', 0],
    ['Sabonete Líquido Glicerinado 500ml', 'cosmeticos', 'PH neutro, espuma cremosa, fragrância suave.', 34.90, 90, 'https://images.unsplash.com/photo-1559591935-c6c92c6cdc55?w=600', 0]
  ];
  for (const [name, cat, desc, price, stock, img, feat] of items) {
    const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await pool.execute(
      'INSERT INTO products (name, slug, category, description, price, stock, image_url, featured) VALUES (?,?,?,?,?,?,?,?)',
      [name, slug, cat, desc, price, stock, img, feat]
    );
  }
}

// ---------- Helpers ----------
function brl(n) { return 'R$ ' + Number(n).toFixed(2).replace('.', ','); }
function getCart(req) {
  try { return JSON.parse(req.cookies.cart || '[]'); } catch { return []; }
}
function setCart(res, cart) {
  res.cookie('cart', JSON.stringify(cart), { httpOnly: false, maxAge: 7*24*3600*1000 });
}
function calcShipping(cep, subtotal) {
  if (subtotal >= SHIPPING_FREE_THRESHOLD) return 0;
  const d = (cep || '').replace(/\D/g, '');
  if (d.length < 5) return 24.90;
  const p = parseInt(d.slice(0, 1), 10);
  // 0,1 SP / 2 RJ-ES / 3 MG / 4 BA-SE / 5 NE / 6 N-CE / 7 DF-GO / 8 PR-SC / 9 RS
  if (p <= 1) return 14.90;
  if (p <= 3) return 19.90;
  if (p === 8 || p === 9) return 22.90;
  return 29.90;
}
function genTrack() {
  return 'TL' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}
async function cartDetail(cart) {
  if (!cart.length) return { items: [], subtotal: 0 };
  const ids = cart.map(c => c.id);
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.execute(`SELECT id, name, slug, price, stock, image_url, category FROM products WHERE id IN (${placeholders})`, ids);
  const map = new Map(rows.map(r => [r.id, r]));
  const items = cart.map(c => {
    const p = map.get(c.id);
    if (!p) return null;
    const qty = Math.min(c.qty, p.stock);
    return { ...p, qty, line: Number(p.price) * qty };
  }).filter(Boolean);
  const subtotal = items.reduce((s, i) => s + i.line, 0);
  return { items, subtotal };
}

app.locals.brl = brl;
app.locals.CATEGORIES = CATEGORIES;

app.use(async (req, res, next) => {
  const cart = getCart(req);
  res.locals.cartCount = cart.reduce((s, c) => s + c.qty, 0);
  res.locals.path = req.path;
  next();
});

// ---------- Public routes ----------
app.get('/', async (req, res) => {
  const [featured] = await pool.execute('SELECT * FROM products WHERE featured=1 ORDER BY RAND() LIMIT 8');
  const [latest] = await pool.execute('SELECT * FROM products ORDER BY created_at DESC LIMIT 4');
  res.render('home', { featured, latest });
});

// ---------- SEO: robots.txt + sitemap.xml ----------
const SITE_BASE = (process.env.SITE_URL || 'https://tialinda.com.br').replace(/\/$/, '');

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /admin\n' +
    'Disallow: /carrinho\n' +
    'Disallow: /checkout\n' +
    'Disallow: /pedido/\n' +
    'Disallow: /rastrear\n\n' +
    'Sitemap: ' + SITE_BASE + '/sitemap.xml\n'
  );
});

app.get('/sitemap.xml', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: SITE_BASE + '/', priority: '1.0', changefreq: 'daily' }
  ];
  for (const c of CATEGORIES) {
    urls.push({ loc: SITE_BASE + '/categoria/' + c.slug, priority: '0.8', changefreq: 'weekly' });
  }
  try {
    const [prods] = await pool.execute('SELECT id, created_at FROM products ORDER BY id');
    for (const p of prods) {
      const lastmod = p.created_at ? new Date(p.created_at).toISOString().slice(0, 10) : today;
      urls.push({ loc: SITE_BASE + '/produto/' + p.id, priority: '0.7', changefreq: 'weekly', lastmod });
    }
  } catch (e) { console.error('[sitemap] erro:', e.message); }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u =>
      '  <url>\n' +
      '    <loc>' + u.loc + '</loc>\n' +
      '    <lastmod>' + (u.lastmod || today) + '</lastmod>\n' +
      '    <changefreq>' + u.changefreq + '</changefreq>\n' +
      '    <priority>' + u.priority + '</priority>\n' +
      '  </url>'
    ).join('\n') + '\n</urlset>\n';
  res.type('application/xml').send(xml);
});

app.get('/categoria/:slug', async (req, res) => {
  const cat = CATEGORIES.find(c => c.slug === req.params.slug);
  if (!cat) return res.status(404).render('404');
  const [products] = await pool.execute('SELECT * FROM products WHERE category=? ORDER BY featured DESC, name', [cat.slug]);
  res.render('category', { cat, products });
});

app.get('/produto/:id', async (req, res) => {
  const [[p]] = await pool.execute('SELECT * FROM products WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).render('404');
  const [related] = await pool.execute('SELECT * FROM products WHERE category=? AND id<>? ORDER BY RAND() LIMIT 4', [p.category, p.id]);
  res.render('product', { p, related });
});

function cookieRedirect(res, url, msg) {
  res.set('Cache-Control', 'no-store');
  res.send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${url}"><title>${msg}</title><p style="font-family:system-ui;padding:24px">${msg}… <a href="${url}">clique aqui</a> se não for redirecionado.</p>`);
}

app.post('/carrinho/adicionar', (req, res) => {
  const id = parseInt(req.body.id, 10);
  const qty = Math.max(1, parseInt(req.body.qty || '1', 10));
  const cart = getCart(req);
  const i = cart.findIndex(c => c.id === id);
  if (i >= 0) cart[i].qty += qty; else cart.push({ id, qty });
  setCart(res, cart);
  cookieRedirect(res, '/carrinho', 'Adicionando ao carrinho');
});

app.post('/carrinho/atualizar', (req, res) => {
  const id = parseInt(req.body.id, 10);
  const qty = parseInt(req.body.qty, 10);
  let cart = getCart(req);
  if (qty <= 0) cart = cart.filter(c => c.id !== id);
  else {
    const i = cart.findIndex(c => c.id === id);
    if (i >= 0) cart[i].qty = qty;
  }
  setCart(res, cart);
  cookieRedirect(res, '/carrinho', 'Atualizando carrinho');
});

app.get('/carrinho', async (req, res) => {
  const detail = await cartDetail(getCart(req));
  res.render('cart', detail);
});

app.get('/checkout', async (req, res) => {
  const detail = await cartDetail(getCart(req));
  if (!detail.items.length) return res.redirect('/carrinho');
  res.render('checkout', detail);
});

app.post('/checkout/frete', async (req, res) => {
  const detail = await cartDetail(getCart(req));
  const shipping = calcShipping(req.body.cep, detail.subtotal);
  res.json({ shipping, total: detail.subtotal + shipping, free: shipping === 0 });
});

app.post('/checkout/finalizar', async (req, res) => {
  const detail = await cartDetail(getCart(req));
  if (!detail.items.length) return res.redirect('/carrinho');
  const { name, email, phone, cep, address, city, state, payment } = req.body;
  const shipping = calcShipping(cep, detail.subtotal);
  const total = detail.subtotal + shipping;
  const tracking = genTrack();

  // Validação de cartão (quando aplicável)
  let cardInfo = null;
  if (payment === 'cartao') {
    const num = (req.body.card_number || '').replace(/\D/g, '');
    const holder = (req.body.card_holder || '').trim();
    const exp = (req.body.card_expiry || '').trim();
    const cvv = (req.body.card_cvv || '').replace(/\D/g, '');
    if (!payments.luhn(num)) return res.status(400).send('Número do cartão inválido.');
    if (!holder)             return res.status(400).send('Informe o nome impresso no cartão.');
    if (!/^\d{2}\/\d{2}$/.test(exp)) return res.status(400).send('Validade no formato MM/AA.');
    if (cvv.length < 3)      return res.status(400).send('CVV inválido.');
    cardInfo = {
      brand: payments.detectBrand(num),
      last4: payments.cardLast4(num),
      holder,
      expiry: exp,
      installments: Math.max(1, Math.min(6, parseInt(req.body.installments || '1', 10)))
    };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      'INSERT INTO orders (customer_name,email,phone,cep,address,city,state,subtotal,shipping,total,payment,status,tracking_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [name, email, phone, cep, address, city, state, detail.subtotal, shipping, total, payment, 'pendente', tracking]
    );
    const orderId = r.insertId;
    for (const it of detail.items) {
      await conn.execute('INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?,?,?,?,?)',
        [orderId, it.id, it.name, it.price, it.qty]);
      await conn.execute('UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id=?', [it.qty, it.id]);
    }
    await conn.commit();
    res.cookie('cart', '[]', { maxAge: 0 });
    // Dispara e-mails de confirmação (cliente + admin) sem bloquear resposta.
    mailer.sendOrderConfirmation(
      { id: orderId, customer_name: name, email, phone, cep, address, city, state,
        subtotal: detail.subtotal, shipping, total, payment, tracking_code: tracking },
      detail.items
    ).catch(err => console.error('[mailer] falha ao enviar pedido #' + orderId + ':', err.message));
    if (cardInfo) {
      res.cookie('last_card', JSON.stringify({ ...cardInfo, orderId }), {
        httpOnly: false, sameSite: 'lax', maxAge: 30 * 60 * 1000, path: '/'
      });
    }
    cookieRedirect(res, '/pedido/' + orderId + '?t=' + tracking, 'Finalizando pedido');
  } catch (e) {
    await conn.rollback();
    res.status(500).send('Erro ao processar pedido: ' + e.message);
  } finally {
    conn.release();
  }
});

app.get('/pedido/:id', async (req, res) => {
  const [[o]] = await pool.execute('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!o) return res.status(404).render('404');
  const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id=?', [o.id]);

  // Artefatos de pagamento (gerados de forma determinística a partir do pedido)
  let pay = { method: o.payment };
  if (o.payment === 'pix') {
    const code = payments.buildPixPayload({
      key: PIX_KEY,
      amount: Number(o.total),
      txid: o.tracking_code,
      merchantName: PIX_NAME,
      merchantCity: PIX_CITY
    });
    pay.pix = { code, qrUrl: payments.pixQrUrl(code, 300) };
  } else if (o.payment === 'boleto') {
    const due = new Date(Date.now() + 3 * 86400000); // vence em 3 dias
    pay.boleto = payments.buildBoleto({ amount: Number(o.total), orderId: o.id, dueDate: due });
  } else if (o.payment === 'cartao') {
    // Recupera info salva no cookie temporário (ver POST /checkout/finalizar)
    try {
      const ck = JSON.parse(req.cookies['last_card'] || '{}');
      if (ck && ck.orderId === o.id) pay.card = ck;
    } catch {}
  }

  res.render('order', { o, items, pay });
});

app.get('/rastrear', async (req, res) => {
  let order = null, items = [], events = [], estDelivery = null;
  const q = (req.query.code || '').trim();
  if (q) {
    // Aceita: código de rastreio (TL...), número do pedido (#7 ou 7), ou e-mail
    let row = null;
    if (/^TL[A-Z0-9]+$/i.test(q)) {
      const [[o]] = await pool.execute('SELECT * FROM orders WHERE tracking_code=?', [q.toUpperCase()]);
      row = o;
    } else if (/^#?\d+$/.test(q)) {
      const id = parseInt(q.replace('#', ''), 10);
      const [[o]] = await pool.execute('SELECT * FROM orders WHERE id=?', [id]);
      row = o;
    } else if (q.includes('@')) {
      const [[o]] = await pool.execute('SELECT * FROM orders WHERE email=? ORDER BY id DESC LIMIT 1', [q]);
      row = o;
    }
    if (row) {
      order = row;
      const [its] = await pool.execute('SELECT * FROM order_items WHERE order_id=?', [row.id]);
      items = its;

      // Timeline de eventos com base no status e na data do pedido
      const created = new Date(row.created_at);
      const steps = [
        { key: 'pendente', label: 'Pedido recebido',     desc: 'Aguardando confirmação do pagamento.', offsetH: 0  },
        { key: 'pago',     label: 'Pagamento confirmado', desc: 'Pedido enviado para separação.',        offsetH: 4  },
        { key: 'enviado',  label: 'Enviado da loja',      desc: 'Objeto postado nos Correios — Santos/SP.', offsetH: 28 },
        { key: 'enviado',  label: 'Em trânsito',          desc: 'Objeto encaminhado para a unidade de destino.', offsetH: 52 },
        { key: 'entregue', label: 'Saiu para entrega',    desc: 'Objeto saiu para entrega ao destinatário.', offsetH: 76 },
        { key: 'entregue', label: 'Entregue',             desc: 'Objeto entregue com sucesso.',           offsetH: 80 }
      ];
      const order_idx = { pendente: 0, pago: 1, enviado: 3, entregue: 5 }[row.status] ?? 0;
      events = steps.map((s, i) => ({
        ...s,
        date: new Date(created.getTime() + s.offsetH * 3600 * 1000),
        done: i <= order_idx,
        active: i === order_idx
      })).reverse(); // mais recente em cima

      estDelivery = new Date(created.getTime() + (5 + Math.floor(Math.random() * 3)) * 86400 * 1000);
    }
  }
  res.render('track', { order, items, events, estDelivery, code: q });
});

// ---------- Admin ----------
function adminAuth(req, res, next) {
  if (req.cookies.admin === ADMIN_PASSWORD) return next();
  res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => res.render('admin/login', { error: null }));
app.post('/admin/login', (req, res) => {
  const pw = (req.body.password || '').trim();
  if (pw === ADMIN_PASSWORD) {
    res.cookie('admin', ADMIN_PASSWORD, { httpOnly: true, sameSite: 'lax', maxAge: 24*3600*1000, path: '/' });
    // Avoid res.redirect() — some serverless proxies strip Set-Cookie on 302.
    res.set('Cache-Control', 'no-store');
    return res.send('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/admin"><title>Entrando…</title><p style="font-family:system-ui;padding:24px">Entrando no painel… <a href="/admin">clique aqui</a> se não for redirecionado.</p>');
  }
  res.render('admin/login', { error: 'Senha incorreta' });
});
app.get('/admin/logout', (req, res) => { res.clearCookie('admin'); res.redirect('/'); });

app.get('/admin', adminAuth, async (req, res) => {
  const [[stats]] = await pool.execute('SELECT COUNT(*) prods, SUM(stock) stock FROM products');
  const [[ord]] = await pool.execute('SELECT COUNT(*) total, COALESCE(SUM(total),0) revenue FROM orders');
  const [[pend]] = await pool.execute("SELECT COUNT(*) c FROM orders WHERE status='pendente'");
  const [low] = await pool.execute('SELECT id, name, stock FROM products WHERE stock < 10 ORDER BY stock ASC LIMIT 6');
  const [recent] = await pool.execute('SELECT id, customer_name, total, status, created_at FROM orders ORDER BY id DESC LIMIT 6');
  res.render('admin/dashboard', { stats, ord, pend, low, recent });
});

app.get('/admin/produtos', adminAuth, async (req, res) => {
  const [products] = await pool.execute('SELECT * FROM products ORDER BY category, name');
  res.render('admin/products', { products });
});

app.get('/admin/produto/novo', adminAuth, (req, res) => res.render('admin/product_form', { p: null }));
app.get('/admin/produto/:id', adminAuth, async (req, res) => {
  const [[p]] = await pool.execute('SELECT * FROM products WHERE id=?', [req.params.id]);
  if (!p) return res.redirect('/admin/produtos');
  res.render('admin/product_form', { p });
});

app.post('/admin/produto/salvar', adminAuth, async (req, res) => {
  const { id, name, category, description, price, stock, image_url, featured } = req.body;
  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const feat = featured ? 1 : 0;
  if (id) {
    await pool.execute('UPDATE products SET name=?, slug=?, category=?, description=?, price=?, stock=?, image_url=?, featured=? WHERE id=?',
      [name, slug, category, description, price, stock, image_url, feat, id]);
  } else {
    await pool.execute('INSERT INTO products (name,slug,category,description,price,stock,image_url,featured) VALUES (?,?,?,?,?,?,?,?)',
      [name, slug, category, description, price, stock, image_url, feat]);
  }
  res.redirect('/admin/produtos');
});

app.post('/admin/produto/:id/excluir', adminAuth, async (req, res) => {
  await pool.execute('DELETE FROM products WHERE id=?', [req.params.id]);
  res.redirect('/admin/produtos');
});

app.get('/admin/pedidos', adminAuth, async (req, res) => {
  const [orders] = await pool.execute('SELECT * FROM orders ORDER BY id DESC');
  res.render('admin/orders', { orders });
});

app.get('/admin/pedido/:id', adminAuth, async (req, res) => {
  const [[o]] = await pool.execute('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!o) return res.redirect('/admin/pedidos');
  const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id=?', [o.id]);
  res.render('admin/order_detail', { o, items });
});

app.post('/admin/pedido/:id/status', adminAuth, async (req, res) => {
  await pool.execute('UPDATE orders SET status=? WHERE id=?', [req.body.status, req.params.id]);
  res.redirect('/admin/pedido/' + req.params.id);
});

// Importação em lote de produtos (JSON). Idempotente: pula slugs já existentes.
app.post('/admin/importar', adminAuth, express.json({ limit: '4mb' }), async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body.items || []);
  let inserted = 0, skipped = 0, errors = 0;
  const slugify = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,200);
  for (const p of items) {
    try {
      const baseSlug = slugify(p.name || p.slug || 'produto');
      const slug = p.old_id ? `${baseSlug}-${p.old_id}` : baseSlug;
      const [existing] = await pool.execute('SELECT id FROM products WHERE slug=?', [slug]);
      if (existing && existing.length) { skipped++; continue; }
      await pool.execute(
        'INSERT INTO products (name, slug, category, description, price, stock, image_url, featured) VALUES (?,?,?,?,?,?,?,?)',
        [
          String(p.name||'').slice(0,200),
          slug,
          String(p.category||'cama').slice(0,40),
          String(p.description||'').slice(0,2000),
          Number(p.price)||0,
          parseInt(p.stock,10)||0,
          String(p.image_url||'').slice(0,500),
          p.featured ? 1 : 0
        ]
      );
      inserted++;
    } catch (e) {
      errors++;
      console.error('[import] erro:', e.message, '| produto:', p.name);
    }
  }
  res.json({ ok: true, total: items.length, inserted, skipped, errors });
});

// Diagnóstico de e-mail — mostra config ativa e tenta enviar um e-mail de teste
app.get('/admin/email-test', adminAuth, async (req, res) => {
  const cfg = {
    ZEPTO_TOKEN: process.env.ZEPTO_TOKEN ? '✓ definido (' + process.env.ZEPTO_TOKEN.length + ' chars)' : '(não definido)',
    MAIL_FROM: process.env.MAIL_FROM || '(não definido — usando default)',
    MAIL_ADMIN: process.env.MAIL_ADMIN || '(não definido — usando default)',
    SITE_URL: process.env.SITE_URL || '(não definido — usando default)'
  };
  const result = await mailer.send({
    to: process.env.MAIL_ADMIN || 'tialindasac@tialinda.com.br',
    subject: '[DIAG] Teste ZeptoMail — ' + new Date().toISOString(),
    html: '<h2>Diagnóstico ZeptoMail</h2><p>Se você está lendo isto, a API HTTP do ZeptoMail está funcionando no Render.</p><pre>' + JSON.stringify(cfg, null, 2) + '</pre>',
    text: 'Teste de diagnóstico ZeptoMail'
  });
  res.json({ config: cfg, sendResult: result });
});

// Remove produtos seed (identificados pela URL de imagem do Unsplash)
app.post('/admin/limpar-seed', adminAuth, async (req, res) => {
  const [r] = await pool.execute("DELETE FROM products WHERE image_url LIKE '%unsplash%'");
  res.json({ ok: true, removed: r.affectedRows || 0 });
});

app.use((req, res) => res.status(404).render('404'));

(async () => {
  const port = parseInt(process.env.PORT || '3000', 10);
  try {
    console.log('[startup] running migrate()...');
    await migrate();
    console.log('[startup] migrate ok');
  } catch (e) {
    console.error('[startup] migrate FAILED:', e && e.stack || e);
  }
  app.listen(port, '0.0.0.0', () => console.log('Tia Linda rodando em :' + port));
})();
