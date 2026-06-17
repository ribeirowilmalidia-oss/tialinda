/**
 * Tia Linda — payments helper
 *
 * Funções para gerar:
 *  - PIX BR Code (EMV) "copia e cola" + payload válido com CRC16-CCITT
 *  - Boleto: 44 dígitos do código de barras + 47 dígitos da linha digitável,
 *            com DACs (mod10 / mod11) calculados conforme FEBRABAN
 *  - Validação de cartão (Luhn) + detecção de bandeira
 *
 * Esses dados são gerados de forma determinística a partir do pedido,
 * portanto NÃO precisam de coluna nova no banco — basta chamar no render.
 */

// ============================================================
// PIX (BR Code / EMV)
// ============================================================

function emv(id, value) {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= (payload.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function stripDiacritics(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase().trim();
}

/**
 * Gera o "copia e cola" PIX a partir de uma chave (e-mail, telefone, CPF/CNPJ
 * ou chave aleatória), valor e identificador da transação.
 */
function buildPixPayload({ key, amount, txid, merchantName, merchantCity }) {
  const name = stripDiacritics(merchantName).slice(0, 25) || 'TIA LINDA ENXOVAIS';
  const city = stripDiacritics(merchantCity).slice(0, 15) || 'SANTOS';
  const id   = (txid || 'TX').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || 'TX';

  const gui    = emv('00', 'br.gov.bcb.pix');
  const pixKey = emv('01', key);
  const merchantAcc = emv('26', gui + pixKey);

  const payload =
    emv('00', '01') +
    merchantAcc +
    emv('52', '0000') +
    emv('53', '986') +
    emv('54', Number(amount).toFixed(2)) +
    emv('58', 'BR') +
    emv('59', name) +
    emv('60', city) +
    emv('62', emv('05', id)) +
    '6304';

  return payload + crc16(payload);
}

/**
 * URL de imagem de QR Code para o PIX (usando o serviço público da QuickChart,
 * que devolve um PNG pronto sem precisar instalar libs nativas).
 */
function pixQrUrl(code, size = 280) {
  return `https://quickchart.io/qr?text=${encodeURIComponent(code)}&size=${size}&margin=1&ecLevel=M`;
}

// ============================================================
// BOLETO (FEBRABAN — 44 dígitos de barras / 47 dígitos digitáveis)
// ============================================================

function mod10(num) {
  let sum = 0, mul = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let s = parseInt(num[i], 10) * mul;
    if (s > 9) s = Math.floor(s / 10) + (s % 10);
    sum += s;
    mul = (mul === 2) ? 1 : 2;
  }
  const r = sum % 10;
  return r === 0 ? 0 : 10 - r;
}

function mod11(num) {
  let sum = 0, mul = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += parseInt(num[i], 10) * mul;
    mul++;
    if (mul > 9) mul = 2;
  }
  const r = sum % 11;
  const dac = 11 - r;
  return (dac === 0 || dac === 10 || dac === 11) ? 1 : dac;
}

function fatorVencimento(dueDate) {
  // Base FEBRABAN: 1000 == 21/02/2025; 1 dia = +1.
  const base = Date.UTC(2025, 1, 21);
  const d = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return 1000 + Math.round((d - base) / 86400000);
}

/**
 * Monta um boleto demonstração (Banco do Brasil — banco 001) com DACs reais.
 *  - amount: número (ex.: 199.90)
 *  - orderId: usado como "nosso número"
 *  - dueDate: Date (vencimento)
 */
function buildBoleto({ amount, orderId, dueDate }) {
  const banco  = '001';
  const moeda  = '9';
  const fator  = fatorVencimento(dueDate).toString().padStart(4, '0').slice(-4);
  const valor  = Math.round(Number(amount) * 100).toString().padStart(10, '0');

  // Campo livre (25) — layout Banco do Brasil (Convênio 7 dígitos + nosso número 17)
  const convenio    = '1234567';
  const nossoNumero = orderId.toString().padStart(17, '0').slice(-17);
  const campoLivre  = (convenio + nossoNumero).padStart(25, '0').slice(-25);

  // Monta a barra sem o DAC geral
  const barraSemDac = banco + moeda + fator + valor + campoLivre;       // 4 + 5 + 10 + 25 = 44 – 1 (DAC)
  // barraSemDac tem 43 chars. Calcular DAC geral (mod11) e inserir na 5ª posição.
  const dacGeral = mod11(barraSemDac);
  const barra    = barraSemDac.slice(0, 4) + dacGeral + barraSemDac.slice(4); // 44 dígitos

  // Linha digitável (47 dígitos):
  //  Campo 1: banco(3) + moeda(1) + livre[1..5]   + DAC1 (mod10)
  //  Campo 2: livre[6..15] + DAC2 (mod10)
  //  Campo 3: livre[16..25] + DAC3 (mod10)
  //  Campo 4: DAC geral
  //  Campo 5: fator(4) + valor(10)
  const c1raw = banco + moeda + campoLivre.slice(0, 5);
  const c2raw = campoLivre.slice(5, 15);
  const c3raw = campoLivre.slice(15, 25);
  const c1 = c1raw + mod10(c1raw);
  const c2 = c2raw + mod10(c2raw);
  const c3 = c3raw + mod10(c3raw);
  const c4 = dacGeral.toString();
  const c5 = fator + valor;

  const linha = [
    c1.slice(0, 5) + '.' + c1.slice(5),
    c2.slice(0, 5) + '.' + c2.slice(5),
    c3.slice(0, 5) + '.' + c3.slice(5),
    c4,
    c5
  ].join('  ');

  return {
    barcode: barra,            // 44 dígitos
    digitable: linha,          // string formatada para humano
    digits: c1 + c2 + c3 + c4 + c5, // 47 dígitos puros
    dueDate,
    amount: Number(amount)
  };
}

// ============================================================
// CARTÃO (validação + bandeira)
// ============================================================

function luhn(num) {
  const s = (num || '').replace(/\D/g, '');
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = parseInt(s[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function detectBrand(num) {
  const s = (num || '').replace(/\D/g, '');
  if (/^4/.test(s))                 return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(s))   return 'Mastercard';
  if (/^3[47]/.test(s))             return 'Amex';
  if (/^6(?:011|5)/.test(s))        return 'Discover';
  if (/^(4011|4312|4389|4514|4573|5041|5066|5067|509|6277|6362|6504|6505|6516|6550)/.test(s)) return 'Elo';
  if (/^(606282|3841)/.test(s))     return 'Hipercard';
  return 'Cartão';
}

function cardLast4(num) {
  const s = (num || '').replace(/\D/g, '');
  return s.slice(-4);
}

module.exports = {
  buildPixPayload,
  pixQrUrl,
  buildBoleto,
  luhn,
  detectBrand,
  cardLast4
};
