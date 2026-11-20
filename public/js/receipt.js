import { formatAmount, formatNumber, formatValueDate, code } from './format.js';
import { getSummary } from './panel-view.js';
import { getProfile, updateProfile, formatPagoMovilLines, hasPagoMovilData } from './profile-store.js';
import { saveReceiptToDb, fetchSavedReceipts, deleteReceiptFromDb } from './db-sync.js';
import { toast } from './toast.js';

const $ = (sel) => document.querySelector(sel);
const dialog = $('#receipt-dialog');

let current = null; // { summary, issuedAt, number, meta, file }

function receiptNumber(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function issuedText(date) {
  return date.toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });
}

// Shared by the on-screen receipt and the PNG so both always say the same thing.
function rateLine(rates) {
  const label = rates.isCustom ? (rates.customLabel || 'Tasa personalizada') : 'Tasa BCV';
  return `${label}: 1 USD = ${formatNumber(rates.usd, 2)} Bs · 1 EUR = ${formatNumber(rates.eur, 2)} Bs`;
}

function valueDateLine(rates) {
  if (rates.isCustom) return 'Calculado con tasa personalizada (no oficial BCV)';
  return `Fecha valor ${formatValueDate(rates.valueDate)}`;
}

function ratesText(rates) {
  return `${rateLine(rates)} · ${valueDateLine(rates)}`;
}

function readReceiptMeta() {
  const profile = getProfile();
  return {
    businessName: $('#rec-business')?.value.trim() ?? profile.businessName,
    clientName: $('#rec-client')?.value.trim() ?? profile.clientName,
    note: $('#rec-note')?.value.trim() ?? profile.receiptNote,
    includePm: $('#rec-include-pm')?.checked ?? profile.pagoMovil.enabled,
    pmLines: formatPagoMovilLines(profile),
  };
}

/* ---------- On-screen / printable receipt ---------- */

function render({ summary, issuedAt, number, meta }) {
  const out = code(summary.currency);
  $('#receipt-title').textContent = meta.businessName || 'Recibo de cálculo';
  $('#receipt-meta').textContent = `N.º ${number} · ${issuedText(issuedAt)}`;

  const clientEl = $('#receipt-client');
  if (clientEl) {
    clientEl.hidden = !meta.clientName;
    clientEl.textContent = meta.clientName ? `Cliente: ${meta.clientName}` : '';
  }

  $('#receipt-lines').replaceChildren(...summary.lines.map((line) => {
    const tr = document.createElement('tr');
    const qtyPrefix = line.qty > 1 ? `${line.qty} × ` : '';
    const cells = [
      line.name,
      `${qtyPrefix}${formatAmount(line.amount)} ${code(line.from)}`,
      `${formatAmount(line.result)} ${code(line.to)}`,
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  }));

  $('#receipt-total').textContent = `${formatAmount(summary.total)} ${out}`;
  $('#receipt-rates').textContent = ratesText(summary.rates);

  const customNoteEl = $('#receipt-custom-note');
  if (customNoteEl) {
    customNoteEl.hidden = !meta.note;
    customNoteEl.textContent = meta.note || '';
  }

  const pmBox = $('#receipt-pm');
  if (pmBox) {
    const showPm = meta.includePm && meta.pmLines.length > 0;
    pmBox.hidden = !showPm;
    if (showPm) {
      pmBox.innerHTML = '';
      const heading = document.createElement('strong');
      heading.textContent = 'Datos Pago Móvil';
      pmBox.append(heading);
      for (const l of meta.pmLines) {
        const span = document.createElement('span');
        span.textContent = l;
        pmBox.append(span);
      }
    }
  }
}

let persistTimer = null;

function persistCurrentReceipt(receipt) {
  if (!receipt || receipt.readOnly) return;
  const { summary, issuedAt, number, meta } = receipt;
  const payload = {
    receiptNumber: number,
    title: meta.businessName || 'Recibo de cálculo',
    clientName: meta.clientName || '',
    note: meta.note || '',
    totalCurrency: summary.currency,
    totalAmount: summary.total,
    rateUsd: summary.rates.usd,
    rateEur: summary.rates.eur,
    rateLabel: summary.rates.isCustom ? (summary.rates.customLabel || 'Tasa personalizada') : 'Tasa BCV',
    valueDate: summary.rates.isCustom ? null : summary.rates.valueDate,
    pagoMovil: meta.includePm && meta.pmLines.length ? meta.pmLines : null,
    issuedAt: issuedAt.toISOString(),
    items: summary.lines.map((l) => ({
      name: l.name,
      from: l.from,
      to: l.to,
      unitAmount: l.amount,
      qty: l.qty > 1 ? l.qty : 1,
      resultAmount: l.result,
      convertedAmount: l.converted,
    })),
  };
  saveReceiptToDb(payload);
}

function syncReceiptMeta() {
  if (!current || current.readOnly) return;
  current.meta = readReceiptMeta();
  // Persist businessName, clientName, receiptNote and PM toggle so next time it remembers.
  updateProfile({
    businessName: current.meta.businessName,
    clientName: current.meta.clientName,
    receiptNote: current.meta.note,
    pagoMovil: { enabled: current.meta.includePm },
  });
  render(current);
  current.file = makeFile(current);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistCurrentReceipt(current), 400);
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

  const editFold = $('.receipt__edit');
  if (editFold) editFold.hidden = false;

  const profile = getProfile();
  if ($('#rec-business')) $('#rec-business').value = profile.businessName;
  if ($('#rec-client')) $('#rec-client').value = profile.clientName;
  if ($('#rec-note')) $('#rec-note').value = profile.receiptNote;
  const pmCheck = $('#rec-include-pm');
  if (pmCheck) {
    pmCheck.checked = profile.pagoMovil.enabled && hasPagoMovilData(profile);
    pmCheck.disabled = !hasPagoMovilData(profile);
  }

  const issuedAt = new Date();
  const meta = readReceiptMeta();
  current = { summary, issuedAt, number: receiptNumber(issuedAt), meta, readOnly: false };
  render(current);
  // Build the PNG right away so sharing can start inside the tap (iOS drops the gesture otherwise).
  current.file = makeFile(current);
  persistCurrentReceipt(current);
  dialog.showModal();
}

function openSavedReceipt(rec) {
  const editFold = $('.receipt__edit');
  if (editFold) editFold.hidden = true;
  const isCustom = rec.rateLabel !== 'Tasa BCV';
  const summary = {
    currency: rec.totalCurrency,
    total: rec.totalAmount,
    lines: rec.items.map((it) => ({
      name: it.name,
      from: it.from,
      to: it.to,
      amount: it.unitAmount,
      qty: it.qty,
      result: it.resultAmount,
      converted: it.convertedAmount,
    })),
    rates: {
      usd: rec.rateUsd,
      eur: rec.rateEur,
      valueDate: rec.bcvValueDate,
      isCustom,
      customLabel: rec.rateLabel,
    },
  };
  const meta = {
    businessName: rec.title,
    clientName: rec.clientName || '',
    note: rec.note || '',
    includePm: Array.isArray(rec.pagoMovil) && rec.pagoMovil.length > 0,
    pmLines: Array.isArray(rec.pagoMovil) ? rec.pagoMovil : [],
  };
  current = {
    summary,
    issuedAt: new Date(rec.issuedAt),
    number: rec.receiptNumber,
    meta,
    readOnly: true,
  };
  render(current);
  current.file = makeFile(current);
  dialog.showModal();
}

async function openSavedReceiptsHistory() {
  const histDialog = $('#receipts-history-dialog');
  const listEl = $('#saved-receipts-list');
  if (!histDialog || !listEl) return;

  listEl.innerHTML = '<li class="saved-rec__empty">Cargando recibos guardados…</li>';
  histDialog.showModal();

  const receipts = await fetchSavedReceipts();
  if (receipts === null) {
    listEl.innerHTML = '<li class="saved-rec__empty">Sin conexión con la base de datos SQLite en este momento.</li>';
    return;
  }
  if (receipts.length === 0) {
    listEl.innerHTML = '<li class="saved-rec__empty">Aún no hay recibos guardados. Se guardan automáticamente cada vez que generas un recibo.</li>';
    return;
  }

  listEl.replaceChildren(...receipts.map((rec) => {
    const li = document.createElement('li');
    li.className = 'saved-rec__item';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'saved-rec__open';
    const title = document.createElement('strong');
    title.className = 'saved-rec__title';
    title.textContent = rec.clientName ? `${rec.title} · ${rec.clientName}` : rec.title;
    const meta = document.createElement('span');
    meta.className = 'saved-rec__meta';
    meta.textContent = `${issuedText(new Date(rec.issuedAt))} · ${rec.items.length} ${rec.items.length === 1 ? 'ítem' : 'ítems'}`;
    const total = document.createElement('span');
    total.className = 'saved-rec__total num';
    total.textContent = `${formatAmount(rec.totalAmount)} ${code(rec.totalCurrency)}`;
    openBtn.append(title, total, meta);
    openBtn.addEventListener('click', () => {
      histDialog.close();
      openSavedReceipt(rec);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn item__delete';
    delBtn.setAttribute('aria-label', `Eliminar recibo ${rec.receiptNumber}`);
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    delBtn.addEventListener('click', async () => {
      const ok = await deleteReceiptFromDb(rec.id);
      if (ok) {
        li.remove();
        if (listEl.children.length === 0) {
          listEl.innerHTML = '<li class="saved-rec__empty">No quedan recibos guardados.</li>';
        }
        toast('Recibo eliminado de SQLite');
      }
    });

    li.append(openBtn, delBtn);
    return li;
  }));
}

/* ---------- Image download (drawn on a canvas, no dependencies) ---------- */

const canvasFont = (weight, size) => `${weight} ${size}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
const NAME_WIDTH = 220;
const NAME_LINE = 22;

/** Word-wraps text to a max width, splitting words that are too long on their own. */
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    let rest = word;
    while (ctx.measureText(rest).width > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut -= 1;
      if (line) { lines.push(line); line = ''; }
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    const next = line ? `${line} ${rest}` : rest;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = rest; } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawReceipt({ summary, issuedAt, number, meta }) {
  const W = 640;
  const PAD = 40;
  const ROW = 44;
  const out = code(summary.currency);
  // Wrap names and optional note first so the canvas is tall enough to show every line in full.
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = canvasFont(600, 17);
  const names = summary.lines.map((line) => wrapText(measure, line.name, NAME_WIDTH));
  const rowsHeight = names.reduce((sum, n) => sum + ROW + (n.length - 1) * NAME_LINE, 0);

  measure.font = canvasFont(500, 14);
  const noteLines = meta.note ? wrapText(measure, meta.note, W - PAD * 2) : [];
  const showPm = meta.includePm && meta.pmLines.length > 0;

  const clientExtra = meta.clientName ? 28 : 0;
  const noteExtra = noteLines.length ? 16 + noteLines.length * 20 : 0;
  const pmExtra = showPm ? 32 + meta.pmLines.length * 20 + 18 : 0;

  const H = 250 + clientExtra + rowsHeight + 170 + noteExtra + pmExtra;
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const font = canvasFont;

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
  ctx.fillText(meta.businessName || 'Recibo de cálculo', PAD, y);

  if (meta.clientName) {
    y += 26;
    ctx.fillStyle = '#4B5563';
    ctx.font = font(600, 15);
    ctx.fillText(`Cliente: ${meta.clientName}`, PAD, y);
  }

  y += 44;
  ctx.fillStyle = '#6B7280';
  ctx.font = font(700, 13);
  ctx.fillText('CONCEPTO', PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText('MONTO', W - PAD - 170, y);
  ctx.fillText('EQUIVALE', W - PAD, y);
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

  summary.lines.forEach((line, i) => {
    y += ROW;
    const qtyPrefix = line.qty > 1 ? `${line.qty}× ` : '';
    ctx.fillStyle = '#111827';
    ctx.font = font(600, 17);
    names[i].forEach((text, k) => ctx.fillText(text, PAD, y + k * NAME_LINE));
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4B5563';
    ctx.font = font(500, 16);
    ctx.fillText(`${qtyPrefix}${formatAmount(line.amount)} ${code(line.from)}`, W - PAD - 170, y);
    ctx.fillStyle = '#111827';
    ctx.font = font(700, 17);
    ctx.fillText(`${formatAmount(line.result)} ${code(line.to)}`, W - PAD, y);
    ctx.textAlign = 'left';
    y += (names[i].length - 1) * NAME_LINE;
    rule(y + 16);
  });

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

  if (showPm) {
    y += 28;
    const boxH = 26 + meta.pmLines.length * 20;
    ctx.fillStyle = '#F3F6FC';
    ctx.beginPath();
    ctx.roundRect(PAD, y, W - PAD * 2, boxH, 10);
    ctx.fill();
    ctx.fillStyle = '#1D5FD6';
    ctx.font = font(700, 13);
    ctx.fillText('DATOS PAGO MÓVIL', PAD + 14, y + 20);
    ctx.fillStyle = '#111827';
    ctx.font = font(600, 14);
    meta.pmLines.forEach((pmLine, idx) => {
      ctx.fillText(pmLine, PAD + 14, y + 40 + idx * 20);
    });
    y += boxH + 14;
  }

  if (noteLines.length) {
    y += 24;
    ctx.fillStyle = '#374151';
    ctx.font = font(500, 14);
    noteLines.forEach((nLine, idx) => {
      ctx.fillText(nLine, PAD, y + idx * 20);
    });
    y += (noteLines.length - 1) * 20;
  }

  y += 38;
  ctx.fillStyle = '#6B7280';
  ctx.font = font(500, 13);
  ctx.fillText(rateLine(summary.rates), PAD, y);
  ctx.fillText(valueDateLine(summary.rates), PAD, y + 20);
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('Documento informativo. No sustituye una factura fiscal.', PAD, y + 48);

  return canvas;
}

/** Renders the receipt to a PNG File (null if the browser can't encode it). */
function makeFile(receipt) {
  return new Promise((resolve) => {
    drawReceipt(receipt).toBlob((blob) => {
      resolve(blob ? new File([blob], `recibo-bcvcalc-${receipt.number}.png`, { type: 'image/png' }) : null);
    }, 'image/png');
  });
}

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadImage() {
  const file = await current?.file;
  if (!file) {
    toast('No se pudo generar la imagen.', { tone: 'error' });
    return;
  }
  saveFile(file);
  toast('Recibo descargado');
}

/**
 * Opens the system share sheet with the receipt image so it can go to WhatsApp as a picture.
 * Needs HTTPS and a browser that shares files (Android Chrome, iOS Safari). Otherwise the
 * image is downloaded so it can be attached by hand.
 */
async function shareImage() {
  const file = await current?.file;
  if (!file) {
    toast('No se pudo generar la imagen.', { tone: 'error' });
    return;
  }
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Recibo de cálculo' });
    } catch (err) {
      if (err.name !== 'AbortError') toast('No se pudo compartir la imagen.', { tone: 'error' });
    }
    return;
  }
  saveFile(file);
  toast('Este navegador no comparte imágenes. Se descargó el recibo para adjuntarlo en WhatsApp.');
}

/* ---------- Init ---------- */

export function initReceipt() {
  $('#open-receipt').addEventListener('click', openReceipt);
  $('#open-saved-receipts')?.addEventListener('click', openSavedReceiptsHistory);
  $('#receipts-history-close')?.addEventListener('click', () => $('#receipts-history-dialog')?.close());
  $('#receipts-history-dialog')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  $('#receipt-print').addEventListener('click', () => window.print());
  $('#receipt-share').addEventListener('click', shareImage);
  $('#receipt-download').addEventListener('click', downloadImage);
  $('#receipt-close').addEventListener('click', () => dialog.close());

  for (const id of ['#rec-business', '#rec-client', '#rec-note']) {
    $(id)?.addEventListener('input', syncReceiptMeta);
  }
  $('#rec-include-pm')?.addEventListener('change', syncReceiptMeta);

  // Tapping the backdrop closes the receipt.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
