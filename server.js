// Tia Linda E-commerce - Express + MySQL (TiDB)
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const pool = require('./db');
const payments = require('./lib/payments');
const mailer = require('./lib/mailer');
const correios = require('./lib/correios');
const mp = require('./lib/mercadopago');
const dolar = require('./lib/dolar');

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
    price_usd DECIMAL(10,2),
    stock INT NOT NULL DEFAULT 0,
    image_url VARCHAR(500),
    featured TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  try { await pool.execute("ALTER TABLE products ADD COLUMN price_usd DECIMAL(10,2)"); } catch(e) {}
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
    mp_preference_id VARCHAR(80),
    mp_payment_id VARCHAR(80),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  // ALTER tolerante caso a tabela já exista (idempotente)
  try { await pool.execute("ALTER TABLE orders ADD COLUMN mp_preference_id VARCHAR(80)"); } catch(e) {}
  try { await pool.execute("ALTER TABLE orders ADD COLUMN mp_payment_id VARCHAR(80)"); } catch(e) {}
  await pool.execute(`CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(80) PRIMARY KEY,
    v TEXT
  )`);
  // Defaults do reajuste pelo dólar (idempotente)
  const defaults = [
    ['dolar_ativo', '0'],
    ['dolar_referencia', '5.50'],
    ['dolar_markup', '0'],
    ['dolar_ultima_cotacao', ''],
    ['dolar_ultima_atualizacao', '']
  ];
  for (const [k, v] of defaults) {
    try {
      const [ex] = await pool.execute('SELECT k FROM settings WHERE k=?', [k]);
      if (!ex.length) await pool.execute('INSERT INTO settings (k,v) VALUES (?,?)', [k, v]);
    } catch (e) { console.error('[settings default]', k, e.message); }
  }

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
async function cartDetail(cart, pf) {
  if (!cart.length) return { items: [], subtotal: 0 };
  const ids = cart.map(c => c.id);
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.execute(`SELECT id, name, slug, price, price_usd, stock, image_url, category FROM products WHERE id IN (${placeholders})`, ids);
  const factor = (pf && pf.factor) || (typeof pf === 'number' ? pf : 1);
  const rate = pf && pf.rate;
  const markup = (pf && pf.markup) || 0;
  const map = new Map(rows.map(r => [r.id, r]));
  const items = cart.map(c => {
    const p = map.get(c.id);
    if (!p) return null;
    const qty = Math.min(c.qty, p.stock);
    let adjustedPrice;
    // Se o produto tem price_usd, usa cotação × (1+markup); senão usa factor global sobre price BRL
    if (p.price_usd != null && Number(p.price_usd) > 0 && rate) {
      adjustedPrice = Math.round(Number(p.price_usd) * rate * (1 + markup) * 100) / 100;
    } else {
      adjustedPrice = Math.round(Number(p.price) * factor * 100) / 100;
    }
    return { ...p, price: adjustedPrice, qty, line: adjustedPrice * qty };
  }).filter(Boolean);
  const subtotal = items.reduce((s, i) => s + i.line, 0);
  return { items, subtotal };
}

app.locals.brl = brl;
app.locals.CATEGORIES = CATEGORIES;

// ---------- Reajuste diário pelo dólar ----------
async function getDolarSettings() {
  try {
    const [rows] = await pool.execute(
      "SELECT k, v FROM settings WHERE k IN ('dolar_ativo','dolar_referencia','dolar_markup')"
    );
    const m = {};
    rows.forEach(r => m[r.k] = r.v);
    return {
      ativo: m.dolar_ativo === '1',
      referencia: parseFloat(m.dolar_referencia) || 0,
      markup: parseFloat(m.dolar_markup) || 0
    };
  } catch (e) {
    return { ativo: false, referencia: 0, markup: 0 };
  }
}

// Guarda o último fator aplicado por request (evita batidas repetidas na API)
async function currentPriceFactor() {
  const s = await getDolarSettings();
  if (!s.ativo || !s.referencia) return { factor: 1, active: false };
  const c = await dolar.getRate();
  if (!c.rate) return { factor: 1, active: false, error: 'sem cotação' };
  // Persiste cotação em cache no banco (para exibir no admin)
  try {
    await pool.execute("UPDATE settings SET v=? WHERE k='dolar_ultima_cotacao'", [String(c.rate)]);
    await pool.execute("UPDATE settings SET v=? WHERE k='dolar_ultima_atualizacao'", [new Date().toISOString()]);
  } catch (e) {}
  return {
    factor: dolar.calcFactor(c.rate, s.referencia, s.markup),
    active: true,
    rate: c.rate,
    reference: s.referencia,
    markup: s.markup,
    source: c.source
  };
}

// Aplica o preço final ao produto:
//  - Se o produto tem price_usd (preço em dólar), calcula: price_usd × cotação × (1 + markup)
//  - Senão, aplica o fator global (cotação_hoje / referência × (1+markup)) ao price em BRL
// pf = objeto retornado por currentPriceFactor: { factor, active, rate, markup }
function applyFactor(item, pf) {
  if (!item) return item;
  if (Array.isArray(item)) return item.map(i => applyFactor(i, pf));
  const factor = (pf && pf.factor) || (typeof pf === 'number' ? pf : 1);
  const rate = pf && pf.rate;
  const markup = pf && pf.markup || 0;
  const clone = { ...item };
  // Se o produto tem preço em USD e temos cotação, converte
  if (clone.price_usd != null && Number(clone.price_usd) > 0 && rate) {
    const brlPrice = Number(clone.price_usd) * rate * (1 + markup);
    clone.price = Math.round(brlPrice * 100) / 100;
    if (clone.line != null && clone.qty != null) {
      clone.line = Math.round(clone.price * clone.qty * 100) / 100;
    }
    return clone;
  }
  // Senão, aplica o fator global (se factor != 1)
  if (factor === 1) return clone;
  if (clone.price != null) clone.price = Math.round(Number(clone.price) * factor * 100) / 100;
  if (clone.line != null)  clone.line  = Math.round(Number(clone.line)  * factor * 100) / 100;
  return clone;
}

app.use(async (req, res, next) => {
  const cart = getCart(req);
  res.locals.cartCount = cart.reduce((s, c) => s + c.qty, 0);
  res.locals.path = req.path;
  // Sempre busca cotação (produtos com price_usd sempre precisam dela, independente do reajuste global estar ativo)
  if (!req.path.startsWith('/admin') && !req.path.startsWith('/api/') && !req.path.startsWith('/webhook')) {
    try {
      let pf = await currentPriceFactor();
      // Se o reajuste global está off mas ainda precisamos da cotação para produtos USD
      if (!pf.active) {
        const c = await dolar.getRate();
        pf = { factor: 1, active: false, rate: c.rate, markup: 0 };
      }
      res.locals.priceFactorInfo = pf;
    } catch (e) {
      res.locals.priceFactorInfo = { active: false, rate: null, markup: 0, factor: 1 };
    }
  } else {
    res.locals.priceFactorInfo = { active: false, rate: null, markup: 0, factor: 1 };
  }
  next();
});

// Wrapper que ajusta preços após query — usado nas rotas públicas
function adjust(rows, pf) { return applyFactor(rows, pf); }

// ---------- Public routes ----------
app.get('/', async (req, res) => {
  const [featured] = await pool.execute('SELECT * FROM products WHERE featured=1 ORDER BY RAND() LIMIT 8');
  const [latest] = await pool.execute('SELECT * FROM products ORDER BY created_at DESC LIMIT 4');
  const f = res.locals.priceFactorInfo;
  res.render('home', { featured: adjust(featured, f), latest: adjust(latest, f) });
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
  const f = res.locals.priceFactorInfo;
  res.render('category', { cat, products: adjust(products, f) });
});

app.get('/produto/:id', async (req, res) => {
  const [[p]] = await pool.execute('SELECT * FROM products WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).render('404');
  const [related] = await pool.execute('SELECT * FROM products WHERE category=? AND id<>? ORDER BY RAND() LIMIT 4', [p.category, p.id]);
  const f = res.locals.priceFactorInfo;
  res.render('product', { p: applyFactor(p, f), related: adjust(related, f) });
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
  const detail = await cartDetail(getCart(req), res.locals.priceFactorInfo);
  res.render('cart', detail);
});

app.get('/checkout', async (req, res) => {
  const detail = await cartDetail(getCart(req), res.locals.priceFactorInfo);
  if (!detail.items.length) return res.redirect('/carrinho');
  res.render('checkout', detail);
});

app.post('/checkout/frete', async (req, res) => {
  const detail = await cartDetail(getCart(req), res.locals.priceFactorInfo);
  const pkg = correios.packageFromItems(detail.items);
  const quote = correios.calcShipping(req.body.cep, pkg);
  if (!quote) return res.json({ error: 'CEP inválido' });

  const freeShipping = detail.subtotal >= SHIPPING_FREE_THRESHOLD;
  const options = [
    { service: 'PAC',   price: freeShipping ? 0 : quote.pac.price,   days: quote.pac.days,   free: freeShipping },
    { service: 'SEDEX', price: quote.sedex.price, days: quote.sedex.days, free: false }
  ];
  res.json({ options, subtotal: detail.subtotal, billedKg: quote.billedKg });
});

app.post('/checkout/finalizar', async (req, res) => {
  const detail = await cartDetail(getCart(req), res.locals.priceFactorInfo);
  if (!detail.items.length) return res.redirect('/carrinho');
  const { name, email, phone, cep, address, city, state, payment } = req.body;
  const shippingService = (req.body.shipping_service || 'PAC').toUpperCase();
  const pkg = correios.packageFromItems(detail.items);
  const quote = correios.calcShipping(cep, pkg);
  let shipping = 0, shippingDays = 0;
  if (quote) {
    const opt = shippingService === 'SEDEX' ? quote.sedex : quote.pac;
    shipping = (detail.subtotal >= SHIPPING_FREE_THRESHOLD && shippingService === 'PAC') ? 0 : opt.price;
    shippingDays = opt.days;
  }
  const total = detail.subtotal + shipping;
  const tracking = genTrack();

  const conn = await pool.getConnection();
  let orderId;
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      'INSERT INTO orders (customer_name,email,phone,cep,address,city,state,subtotal,shipping,total,payment,status,tracking_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [name, email, phone, cep, address, city, state, detail.subtotal, shipping, total, 'mercadopago', 'aguardando_pagamento', tracking]
    );
    orderId = r.insertId;
    for (const it of detail.items) {
      await conn.execute('INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?,?,?,?,?)',
        [orderId, it.id, it.name, it.price, it.qty]);
      // reserva stock preventivamente
      await conn.execute('UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id=?', [it.qty, it.id]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    conn.release();
    return res.status(500).send('Erro ao processar pedido: ' + e.message);
  } finally {
    conn.release();
  }

  res.cookie('cart', '[]', { maxAge: 0 });

  // Redireciona para a tela de pagamento (Bricks) dentro do site
  cookieRedirect(res, '/pagamento/' + orderId + '?t=' + tracking, 'Preparando pagamento');
});

// Tela de pagamento (Bricks) — PIX, cartão e boleto direto no site
app.get('/pagamento/:id', async (req, res) => {
  const [[o]] = await pool.execute('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!o) return res.status(404).render('404');
  if (o.status === 'pago') return res.redirect('/pedido/' + o.id);
  const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id=?', [o.id]);
  res.render('payment', { o, items, mpPublicKey: mp.PUBLIC_KEY });
});

// Endpoint chamado pelo Bricks JS para processar pagamento
app.post('/api/pagamento/processar', express.json(), async (req, res) => {
  const orderId = parseInt(req.body.orderId, 10);
  const [[o]] = await pool.execute('SELECT * FROM orders WHERE id=?', [orderId]);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (o.status === 'pago') return res.json({ status: 'approved', already: true });

  const paymentData = req.body.paymentData || {};

  // Monta o body pra API do MP baseado no que veio do Bricks
  const body = {
    transaction_amount: Number(o.total),
    description: 'Pedido #' + o.id + ' - Tia Linda Enxovais',
    external_reference: String(o.id),
    payment_method_id: paymentData.payment_method_id,
    payer: {
      email: o.email,
      first_name: (o.customer_name || '').split(' ')[0] || 'Cliente',
      last_name: (o.customer_name || '').split(' ').slice(1).join(' ') || 'Tia Linda',
      identification: paymentData.payer && paymentData.payer.identification
    },
    notification_url: (process.env.SITE_URL || 'https://tialinda.com.br').replace(/\/$/,'') + '/webhook/mercadopago'
  };

  // Cartão de crédito/débito
  if (paymentData.token) {
    body.token = paymentData.token;
    body.installments = paymentData.installments || 1;
    body.issuer_id = paymentData.issuer_id;
  }

  const result = await mp.createPayment(body, 'order-' + o.id + '-' + Date.now());

  if (result.error) {
    return res.status(400).json({ error: result.error, details: result.details });
  }

  const p = result.payment;
  const newStatus = mp.mapStatus(p.status);

  await pool.execute('UPDATE orders SET status=?, mp_payment_id=? WHERE id=?',
    [newStatus, String(p.id), o.id]).catch(() => {});

  // Se aprovado imediatamente (cartão), dispara e-mail
  if (newStatus === 'pago') {
    const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id=?', [o.id]);
    mailer.sendOrderConfirmation({ ...o, status: 'pago' }, items)
      .catch(err => console.error('[mailer]', err.message));
  }

  // Devolve dados úteis pro frontend (QR do PIX, código do boleto, etc)
  res.json({
    id: p.id,
    status: p.status,
    status_detail: p.status_detail,
    payment_method_id: p.payment_method_id,
    point_of_interaction: p.point_of_interaction, // PIX QR aqui
    transaction_details: p.transaction_details    // boleto external_resource_url
  });
});

// Consulta status do pedido (polling do frontend enquanto aguarda PIX)
app.get('/api/pagamento/status/:id', async (req, res) => {
  const [[o]] = await pool.execute('SELECT id, status FROM orders WHERE id=?', [req.params.id]);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json({ id: o.id, status: o.status });
});

// Cliente retorna do Mercado Pago (success / pending / failure)
app.get('/pedido/:id/retorno', async (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  const paymentId = req.query.payment_id || req.query.collection_id;
  const mpStatus  = req.query.status || req.query.collection_status;

  const [[o]] = await pool.execute('SELECT * FROM orders WHERE id=?', [orderId]);
  if (!o) return res.status(404).render('404');

  // Se veio payment_id, consulta o MP pra confirmar o status real
  if (paymentId) {
    const p = await mp.getPayment(paymentId);
    if (p && p.status) {
      const newStatus = mp.mapStatus(p.status);
      await pool.execute('UPDATE orders SET status=?, mp_payment_id=? WHERE id=?',
        [newStatus, String(paymentId), orderId]).catch(() => {});
      // Dispara e-mails só quando aprovado (evita spam em pending)
      if (newStatus === 'pago' && o.status !== 'pago') {
        const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id=?', [orderId]);
        mailer.sendOrderConfirmation({ ...o, status: 'pago' }, items)
          .catch(err => console.error('[mailer]', err.message));
      }
    }
  }

  res.redirect('/pedido/' + orderId + '?mp=' + (mpStatus || 'return'));
});

// Webhook do Mercado Pago (chamado automaticamente pelo MP quando pagamento muda de status)
app.post('/webhook/mercadopago', async (req, res) => {
  res.status(200).send('ok'); // responde rápido, MP dá timeout em 22s

  try {
    const type = req.body.type || req.query.type;
    const dataId = (req.body.data && req.body.data.id) || req.query['data.id'];
    if (type !== 'payment' || !dataId) return;

    const p = await mp.getPayment(dataId);
    if (!p) return;

    const orderId = parseInt(p.external_reference, 10);
    if (!orderId) return;

    const [[o]] = await pool.execute('SELECT * FROM orders WHERE id=?', [orderId]);
    if (!o) return;

    const newStatus = mp.mapStatus(p.status);
    await pool.execute('UPDATE orders SET status=?, mp_payment_id=? WHERE id=?',
      [newStatus, String(dataId), orderId]);

    console.log('[webhook] pedido #' + orderId + ' → ' + newStatus + ' (mp status: ' + p.status + ')');

    if (newStatus === 'pago' && o.status !== 'pago') {
      const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id=?', [orderId]);
      mailer.sendOrderConfirmation({ ...o, status: 'pago' }, items)
        .catch(err => console.error('[mailer]', err.message));
    }
  } catch (e) {
    console.error('[webhook] erro:', e.message);
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
  const dolarSettings = await getDolarSettings();
  let dolarBadge = null;
  if (dolarSettings.ativo) {
    const c = await dolar.getRate().catch(() => ({ rate: null }));
    if (c.rate) {
      dolarBadge = {
        rate: c.rate,
        factor: dolar.calcFactor(c.rate, dolarSettings.referencia, dolarSettings.markup),
        reference: dolarSettings.referencia
      };
    }
  }
  res.render('admin/dashboard', { stats, ord, pend, low, recent, dolarBadge });
});

app.get('/admin/produtos', adminAuth, async (req, res) => {
  const [products] = await pool.execute('SELECT * FROM products ORDER BY category, name');
  res.render('admin/products', { products });
});

app.get('/admin/produto/novo', adminAuth, async (req, res) => {
  const c = await dolar.getRate().catch(() => ({ rate: null }));
  const s = await getDolarSettings();
  res.render('admin/product_form', { p: null, dolarRate: c.rate, dolarMarkup: s.markup });
});
app.get('/admin/produto/:id', adminAuth, async (req, res) => {
  const [[p]] = await pool.execute('SELECT * FROM products WHERE id=?', [req.params.id]);
  if (!p) return res.redirect('/admin/produtos');
  const c = await dolar.getRate().catch(() => ({ rate: null }));
  const s = await getDolarSettings();
  res.render('admin/product_form', { p, dolarRate: c.rate, dolarMarkup: s.markup });
});

app.post('/admin/produto/salvar', adminAuth, async (req, res) => {
  const { id, name, category, description, price, stock, image_url, featured } = req.body;
  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const feat = featured ? 1 : 0;
  // price_usd é opcional — quando definido, sobrescreve o preço BRL dinamicamente
  const rawUsd = String(req.body.price_usd || '').replace(',', '.').trim();
  const price_usd = rawUsd && !isNaN(parseFloat(rawUsd)) && parseFloat(rawUsd) > 0
    ? parseFloat(rawUsd)
    : null;
  if (id) {
    await pool.execute('UPDATE products SET name=?, slug=?, category=?, description=?, price=?, price_usd=?, stock=?, image_url=?, featured=? WHERE id=?',
      [name, slug, category, description, price, price_usd, stock, image_url, feat, id]);
  } else {
    await pool.execute('INSERT INTO products (name,slug,category,description,price,price_usd,stock,image_url,featured) VALUES (?,?,?,?,?,?,?,?,?)',
      [name, slug, category, description, price, price_usd, stock, image_url, feat]);
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

// Tela visual de importação em massa — cole JSON e clique importar
app.get('/admin/importar', adminAuth, (req, res) => {
  res.render('admin/importar', { result: null, jsonInput: '' });
});

app.post('/admin/importar-form', adminAuth, async (req, res) => {
  const jsonText = String(req.body.produtos_json || '').trim();
  let items = [];
  let parseError = null;
  try {
    items = JSON.parse(jsonText);
    if (!Array.isArray(items)) items = [items];
  } catch (e) {
    parseError = 'JSON inválido: ' + e.message;
  }
  if (parseError) {
    return res.render('admin/importar', { result: { error: parseError }, jsonInput: jsonText });
  }
  let inserted = 0, skipped = 0, errors = 0;
  const details = [];
  const slugify = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,200);
  for (const p of items) {
    try {
      const baseSlug = slugify(p.name || p.slug || 'produto');
      const slug = p.old_id ? `${baseSlug}-${p.old_id}` : baseSlug;
      const [existing] = await pool.execute('SELECT id FROM products WHERE slug=?', [slug]);
      if (existing && existing.length) { skipped++; details.push({name: p.name, status: 'pulado (já existe)'}); continue; }
      const rawUsd = p.price_usd != null ? parseFloat(String(p.price_usd).replace(',','.')) : null;
      const price_usd = rawUsd && rawUsd > 0 ? rawUsd : null;
      await pool.execute(
        'INSERT INTO products (name, slug, category, description, price, price_usd, stock, image_url, featured) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          String(p.name||'').slice(0,200),
          slug,
          String(p.category||'cama').slice(0,40),
          String(p.description||'').slice(0,2000),
          Number(p.price)||0,
          price_usd,
          parseInt(p.stock,10)||0,
          String(p.image_url||'').slice(0,500),
          p.featured ? 1 : 0
        ]
      );
      inserted++;
      details.push({name: p.name, status: 'inserido'});
    } catch (e) {
      errors++;
      details.push({name: p.name, status: 'erro: ' + e.message});
    }
  }
  res.render('admin/importar', {
    result: { total: items.length, inserted, skipped, errors, details },
    jsonInput: ''
  });
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

// ---------- Admin: Reajuste diário pelo dólar ----------
app.get('/admin/dolar', adminAuth, async (req, res) => {
  const [rows] = await pool.execute("SELECT k, v FROM settings WHERE k LIKE 'dolar_%'");
  const s = {};
  rows.forEach(r => s[r.k] = r.v);
  const cot = await dolar.getRate().catch(() => ({ rate: null, source: 'erro' }));
  const referencia = parseFloat(s.dolar_referencia) || 0;
  const markup = parseFloat(s.dolar_markup) || 0;
  const ativo = s.dolar_ativo === '1';
  const factor = (cot.rate && referencia) ? dolar.calcFactor(cot.rate, referencia, markup) : 1;
  res.render('admin/dolar', {
    ativo, referencia, markup,
    cotacao: cot.rate,
    fonte: cot.source,
    factor,
    ultimaAtualizacao: s.dolar_ultima_atualizacao || ''
  });
});

app.post('/admin/dolar/salvar', adminAuth, async (req, res) => {
  const ativo = req.body.ativo ? '1' : '0';
  const referencia = parseFloat(String(req.body.referencia).replace(',', '.')) || 0;
  const markup = parseFloat(String(req.body.markup).replace(',', '.')) || 0;
  await pool.execute("UPDATE settings SET v=? WHERE k='dolar_ativo'", [ativo]);
  await pool.execute("UPDATE settings SET v=? WHERE k='dolar_referencia'", [String(referencia)]);
  await pool.execute("UPDATE settings SET v=? WHERE k='dolar_markup'", [String(markup)]);
  res.redirect('/admin/dolar');
});

app.post('/admin/dolar/atualizar-agora', adminAuth, async (req, res) => {
  await dolar.refresh();
  res.redirect('/admin/dolar');
});

// Ajusta cotação de referência para o valor de hoje (congela o preço atual)
app.post('/admin/dolar/usar-cotacao-atual', adminAuth, async (req, res) => {
  const c = await dolar.getRate();
  if (c.rate) {
    await pool.execute("UPDATE settings SET v=? WHERE k='dolar_referencia'", [String(c.rate)]);
  }
  res.redirect('/admin/dolar');
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
