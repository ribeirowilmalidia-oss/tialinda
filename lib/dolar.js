// Cotação diária do dólar (USD → BRL) via awesomeapi.com.br
// API pública, sem cadastro, atualizada em tempo real.
// Docs: https://docs.awesomeapi.com.br/api-de-moedas

let cache = { rate: null, fetchedAt: 0, source: null };
const TTL_MS = 6 * 3600 * 1000; // 6 horas

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

  try {
    const r = await fetchRateFromAwesome();
    cache = { rate: r.rate, fetchedAt: now, source: r.source };
    console.log('[dolar] cotação atualizada:', r.rate, 'via', r.source);
    return cache;
  } catch (e1) {
    console.warn('[dolar] awesomeapi falhou:', e1.message, '— tentando BCB');
    try {
      const r = await fetchRateFromBCB();
      cache = { rate: r.rate, fetchedAt: now, source: r.source };
      console.log('[dolar] cotação atualizada (fallback):', r.rate, 'via', r.source);
      return cache;
    } catch (e2) {
      console.error('[dolar] BCB também falhou:', e2.message);
      // se ainda temos um valor antigo em cache, devolve ele em vez de nada
      if (cache.rate) return cache;
      return { rate: null, fetchedAt: 0, source: 'erro' };
    }
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
