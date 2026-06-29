// Calculadora de frete PAC + SEDEX baseada em tabela interna dos Correios.
// Origem: Santos/SP (CEP 11060-230). Atualizar preços anualmente quando os Correios reajustarem.
//
// Frete = max(peso_real, peso_volumetrico) onde volumétrico = (L*A*C)/6000
//
// Tabela aproximada Correios 2026 — preço por kg + base, por região (1º dígito do CEP destino).
// Região 0-1 = SP, 2 = RJ/ES, 3 = MG, 4 = BA/SE/AL/PE/PB/RN, 5 = PI/MA/CE,
// 6 = N/CE/AM/PA, 7 = DF/GO/TO/RO/AC/RR/AP, 8 = PR/SC, 9 = RS

const ORIGIN_CEP = '11060230';

// { base: R$ fixo até 1kg, perKg: adicional por kg acima de 1kg, daysPAC, daysSEDEX, sedexFactor }
const TABLE = {
  '0': { base: 22.50, perKg: 4.20, pacDays: 4,  sedexDays: 2 },  // SP interior
  '1': { base: 18.90, perKg: 3.50, pacDays: 3,  sedexDays: 1 },  // SP capital + Santos
  '2': { base: 28.50, perKg: 5.10, pacDays: 5,  sedexDays: 2 },  // RJ/ES
  '3': { base: 32.40, perKg: 6.20, pacDays: 6,  sedexDays: 3 },  // MG
  '4': { base: 45.80, perKg: 8.40, pacDays: 9,  sedexDays: 5 },  // BA/SE/AL/PE/PB/RN
  '5': { base: 48.20, perKg: 9.10, pacDays: 10, sedexDays: 5 },  // PI/MA/CE
  '6': { base: 58.40, perKg: 11.50, pacDays: 12, sedexDays: 6 }, // N/CE/AM/PA
  '7': { base: 42.60, perKg: 7.90, pacDays: 8,  sedexDays: 4 },  // DF/GO/TO/RO/AC/RR/AP
  '8': { base: 38.20, perKg: 7.10, pacDays: 7,  sedexDays: 4 },  // PR/SC
  '9': { base: 44.50, perKg: 8.30, pacDays: 9,  sedexDays: 5 }   // RS
};

// SEDEX é ~65% mais caro que PAC e chega na metade do tempo
const SEDEX_FACTOR = 1.65;

function volumetricKg(lengthCm, widthCm, heightCm) {
  return (lengthCm * widthCm * heightCm) / 6000;
}

function billedWeight(realKg, lengthCm, widthCm, heightCm) {
  return Math.max(realKg, volumetricKg(lengthCm, widthCm, heightCm));
}

// pkg = { weightKg, lengthCm, widthCm, heightCm }
function calcShipping(destCep, pkg) {
  const d = (destCep || '').replace(/\D/g, '');
  if (d.length < 5) return null;

  const region = d[0];
  const t = TABLE[region] || TABLE['1'];

  // Peso cobrado: max(real, volumétrico), arredonda pra cima
  const wReal = pkg.weightKg || 1.0;
  const wVol = volumetricKg(pkg.lengthCm || 25, pkg.widthCm || 30, pkg.heightCm || 10);
  const w = Math.max(wReal, wVol);
  const billed = Math.ceil(w);

  // PAC: base (até 1kg) + perKg * (billed - 1)
  const pacPrice = t.base + Math.max(0, billed - 1) * t.perKg;
  const sedexPrice = pacPrice * SEDEX_FACTOR;

  return {
    pac:   { service: 'PAC',   price: round2(pacPrice),   days: t.pacDays },
    sedex: { service: 'SEDEX', price: round2(sedexPrice), days: t.sedexDays },
    billedKg: billed,
    realKg: round2(wReal),
    volumetricKg: round2(wVol)
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

// Calcula peso e dimensões agregadas de um carrinho.
// Cada item assume defaults (1.3kg, 40x30x15) se o produto não tiver dimensões próprias.
function packageFromItems(items) {
  let totalWeight = 0;
  let maxL = 0, maxW = 0, totalH = 0;
  for (const it of items) {
    const w = (it.weight_kg || 1.3) * it.qty;
    totalWeight += w;
    const L = it.length_cm || 40;
    const W = it.width_cm  || 30;
    const H = (it.height_cm || 15) * it.qty;
    if (L > maxL) maxL = L;
    if (W > maxW) maxW = W;
    totalH += H;
  }
  return {
    weightKg: round2(totalWeight),
    lengthCm: maxL || 40,
    widthCm:  maxW || 30,
    heightCm: Math.min(totalH || 15, 100) // limita a 100cm
  };
}

module.exports = { calcShipping, packageFromItems, volumetricKg, billedWeight, ORIGIN_CEP };
