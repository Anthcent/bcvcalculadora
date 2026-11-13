import { formatAmount, formatNumber, formatValueDate, code } from './format.js';
import { getSummary } from './panel-view.js';
import { toast } from './toast.js';

const $ = (sel) => document.querySelector(sel);
const dialog = $('#receipt-dialog');

let current = null; // { summary, issuedAt, number }

function receiptNumber(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function issuedText(date) {
  return date.toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });
}

// Shared by the on-screen receipt and the PNG so both always say the same thing.
function rateLine(rates) {
  return `Tasa BCV: 1 USD = ${formatNumber(rates.usd, 2)} Bs · 1 EUR = ${formatNumber(rates.eur, 2)} Bs`;
}

function valueDateLine(rates) {
  return `Fecha valor ${formatValueDate(rates.valueDate)}`;
}

function ratesText(rates) {
  return `${rateLine(rates)} · ${valueDateLine(rates)}`;
}

/* ---------- On-screen / printable receipt ---------- */

function render({ summary, issuedAt, number }) {
  const out = code(summary.currency);
  $('#receipt-meta').textContent = `N.º ${number} · ${issuedText(issuedAt)}`;
  $('#receipt-out-head').textContent = out;
  $('#receipt-lines').replaceChildren(...summary.lines.map((line) => {
    const tr = document.createElement('tr');
    for (const text of [line.name, `${formatAmount(line.amount)} ${code(line.from)}`, formatAmount(line.converted)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  }));
  $('#receipt-total').textContent = `${formatAmount(summary.total)} ${out}`;
  $('#receipt-rates').textContent = ratesText(summary.rates);
}

function openReceipt() {
  const summary = getSummary();
  if (!summary) {
    toast('No hay tasas disponibles para el recibo.', { tone: 'error' });
    return;
  }
  if (summary.lines.length === 0) {
    toast('No hay cálculos marcados para sumar.', { tone: 'error' });
    return;
  }
  const issuedAt = new Date();
  current = { summary, issuedAt, number: receiptNumber(issuedAt) };
  render(current);
  dialog.showModal();
}

/* ---------- Image download (drawn on a canvas, no dependencies) ---------- */

function drawReceipt({ summary, issuedAt, number }) {
  const W = 640;
  const PAD = 40;
  const ROW = 44;
  const out = code(summary.currency);
  const H = 250 + summary.lines.length * ROW + 170;
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const font = (weight, size) => `${weight} ${size}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Header band with the logo mark.
  ctx.fillStyle = '#0A0E14';
  ctx.fillRect(0, 0, W, 110);
  ctx.fillStyle = '#2F7BFF';
  ctx.beginPath();
  ctx.roundRect(PAD, 27, 56, 56, 15);
  ctx.fill();
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const arrow = (color, points) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(PAD + x, 27 + y) : ctx.moveTo(PAD + x, 27 + y)));
    ctx.stroke();
  };
  arrow('#FFFFFF', [[15, 21], [39, 21]]);
  arrow('#FFFFFF', [[32, 14], [39, 21], [32, 28]]);
  arrow('#0A0E14', [[41, 35], [17, 35]]);
  arrow('#0A0E14', [[24, 28], [17, 35], [24, 42]]);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(800, 26);
  ctx.fillText('BCV', PAD + 72, 64);
  const bcvWidth = ctx.measureText('BCV').width;
  ctx.fillStyle = '#7FB0FF';
  ctx.font = font(600, 26);
  ctx.fillText('Calc', PAD + 74 + bcvWidth, 64);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#C9D3E3';
  ctx.font = font(600, 14);
  ctx.fillText(`N.º ${number}`, W - PAD, 52);
  ctx.fillText(issuedText(issuedAt), W - PAD, 74);
  ctx.textAlign = 'left';

  let y = 160;
  ctx.fillStyle = '#0A0E14';
  ctx.font = font(800, 24);
  ctx.fillText('Recibo de cálculo', PAD, y);

  y += 44;
  ctx.fillStyle = '#6B7280';
  ctx.font = font(700, 13);
  ctx.fillText('CONCEPTO', PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText('MONTO', W - PAD - 170, y);
  ctx.fillText(out.toUpperCase(), W - PAD, y);
  ctx.textAlign = 'left';

  const rule = (atY, color = '#E5E7EB', width = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(PAD, atY);
    ctx.lineTo(W - PAD, atY);
    ctx.stroke();
  };
  rule(y + 14);

  for (const line of summary.lines) {
    y += ROW;
    ctx.fillStyle = '#111827';
    ctx.font = font(600, 17);
    let name = line.name;
    while (ctx.measureText(name).width > 230 && name.length > 3) name = `${name.slice(0, -2)}…`;
    ctx.fillText(name, PAD, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4B5563';
    ctx.font = font(500, 16);
    ctx.fillText(`${formatAmount(line.amount)} ${code(line.from)}`, W - PAD - 170, y);
    ctx.fillStyle = '#111827';
    ctx.font = font(700, 17);
    ctx.fillText(formatAmount(line.converted), W - PAD, y);
    ctx.textAlign = 'left';
    rule(y + 16);
  }

  y += 64;
  rule(y - 34, '#0A0E14', 2);
  ctx.fillStyle = '#111827';
  ctx.font = font(700, 20);
  ctx.fillText('Total', PAD, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#1D5FD6';
  ctx.font = font(800, 30);
  ctx.fillText(`${formatAmount(summary.total)} ${out}`, W - PAD, y);
  ctx.textAlign = 'left';

  y += 42;
  ctx.fillStyle = '#6B7280';
  ctx.font = font(500, 13);
  ctx.fillText(rateLine(summary.rates), PAD, y);
  ctx.fillText(valueDateLine(summary.rates), PAD, y + 20);
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('Documento informativo. No sustituye una factura fiscal.', PAD, y + 48);

  return canvas;
}

function downloadImage() {
  if (!current) return;
  const canvas = drawReceipt(current);
  canvas.toBlob((blob) => {
    if (!blob) {
      toast('No se pudo generar la imagen.', { tone: 'error' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recibo-bcvcalc-${current.number}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Recibo descargado');
  }, 'image/png');
}

/* ---------- Init ---------- */

export function initReceipt() {
  $('#open-receipt').addEventListener('click', openReceipt);
  $('#receipt-print').addEventListener('click', () => window.print());
  $('#receipt-download').addEventListener('click', downloadImage);
  $('#receipt-close').addEventListener('click', () => dialog.close());
  // Tapping the backdrop closes the receipt.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
