// Cotação diária do dólar (USD → BRL).
// Ordem de preferência das fontes:
//   1. dolarpy.com.br (dólar da fronteira PY/BR — cotação real de câmbio na fronteira)
//   2. awesomeapi.com.br (dólar comercial oficial)
//   3. Banco Central do Brasil PTAX (fallback)

let cache = { rate: null, fetchedAt: 0, source: null };
const TTL_MS = 6 * 3600 * 1000; // 6 horas

// Fonte principal: dolarpy.com.br (scraping simples do HTML)
async function fetchRateFromDolarPY() {
  const res = await fetch('https://www.dolarpy.com.br/', {
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TiaLindaBot/1.0)',
      'Accept': 'text/html'
    }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();

  // Padrão 1: "R$ 5.25" (formato do site)
  let m = html.match(/R\$\s*([0-9]+[.,][0-9]{2,4})/);
  // Padrão 2: array de cotações no gráfico (histórico) — pega o último valor
  if (!m) {
    const arr = html.match(/data:\s*\[([0-9.,\s]+)\]/);
    if (arr) {
      const vals = arr[1].split(',').map(s => parseFloat(s.trim())).filter(v => v > 3 && v < 20);
      if (vals.length) return { rate: vals[vals.length - 1], source: 'dolarpy' };
    }
  }
  if (m) {
    const rate = parseFloat(m[1].replace(',', '.'));
    if (rate > 3 && rate < 20) return { rate, source: 'dolarpy' };
  }
  throw new Error('nao foi possivel extrair cotacao do dolarpy');
}

async function fetchRateFromAwesome() {
  const res = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL', {
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const bid = j && j.USDBRL && j.USDBRL.bid;
  const rate = parseFloat(bid);
  if (!rate || rate < 3 || rate > 20) throw new Error('taxa inválida: ' + bid);
  return { rate, source: 'awesomeapi' };
}

// Fallback: Banco Central do Brasil (PTAX)
async function fetchRateFromBCB() {
  const today = new Date();
  // procura até 5 dias pra trás (fins de semana / feriados)
  for (let i = 0; i < 5; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    const mmddyyyy = String(d.getMonth()+1).padStart(2,'0') + '-' +
                     String(d.getDate()).padStart(2,'0') + '-' +
                     d.getFullYear();
    const url = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='" +
                mmddyyyy + "'&$format=json";
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const j = await res.json();
      const rate = j && j.value && j.value[0] && parseFloat(j.value[0].cotacaoVenda);
      if (rate && rate > 3 && rate < 20) return { rate, source: 'bcb-' + mmddyyyy };
    } catch (e) { /* tenta próximo dia */ }
  }
  throw new Error('BCB indisponível');
}

async function getRate() {
  const now = Date.now();
  if (cache.rate && (now - cache.fetchedAt) < TTL_MS) return cache;

  // 1ª tentativa: dolarpy.com.br (fonte definida pela loja)
  try {
    const r = await fetchRateFromDolarPY();
    cache = { rate: r.rate, fetchedAt: now, source: r.source };
    console.log('[dolar] cotação atualizada:', r.rate, 'via', r.source);
    return cache;
  } catch (e0) {
    console.warn('[dolar] dolarpy falhou:', e0.message, '— tentando awesomeapi');
  }

  // 2ª tentativa: awesomeapi
  try {
    const r = await fetchRateFromAwesome();
    cache = { rate: r.rate, fetchedAt: now, source: r.source };
    console.log('[dolar] cotação atualizada:', r.rate, 'via', r.source);
    return cache;
  } catch (e1) {
    console.warn('[dolar] awesomeapi falhou:', e1.message, '— tentando BCB');
  }

  // 3ª tentativa: Banco Central
  try {
    const r = await fetchRateFromBCB();
    cache = { rate: r.rate, fetchedAt: now, source: r.source };
    console.log('[dolar] cotação atualizada (fallback):', r.rate, 'via', r.source);
    return cache;
  } catch (e2) {
    console.error('[dolar] BCB também falhou:', e2.message);
    if (cache.rate) return cache;
    return { rate: null, fetchedAt: 0, source: 'erro' };
  }
}

// Força atualização imediata (usado em rota manual)
async function refresh() {
  cache = { rate: null, fetchedAt: 0, source: null };
  return getRate();
}

// Calcula fator de reajuste: cotação_hoje / cotação_referência × (1 + markup)
function calcFactor(current, reference, markup) {
  const cur = Number(current);
  const ref = Number(reference);
  const mk  = Number(markup) || 0;
  if (!cur || !ref) return 1;
  return (cur / ref) * (1 + mk);
}

module.exports = { getRate, refresh, calcFactor };
