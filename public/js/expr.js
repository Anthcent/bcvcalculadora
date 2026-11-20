/**
 * Pure arithmetic expression evaluator for keypad input (comma decimal, operators + − × ÷ and %).
 * No eval/Function; supports standard operator precedence and Venezuelan percentage semantics:
 *   "100+16%"  -> 116   (base + 16% of base)
 *   "100-10%"  -> 90    (base - 10% of base)
 *   "200×10%"  -> 20    (200 * 0.10)
 *   "50%"      -> 0.5
 * Tolerates incomplete trailing operators while the user is typing ("100+" -> 100).
 */

export const OPERATORS = ['+', '-', '×', '÷'];

const OP_MAP = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '×',
  '×': '×',
  'x': '×',
  'X': '×',
  '/': '÷',
  '÷': '÷',
};

/** Normalizes ASCII/Unicode operator variants into canonical symbols (+, -, ×, ÷). */
export function normalizeOperator(ch) {
  return OP_MAP[ch] ?? null;
}

/** True when the input contains any arithmetic operator or percent sign. */
export function isExpression(input) {
  return /[+\-×÷%]/.test(String(input ?? ''));
}

/**
 * Tokenizes a keypad expression into numbers, operators and percent markers.
 * Example: "12,5+16%" -> [{ type: 'num', value: 12.5 }, { type: 'op', value: '+' }, { type: 'num', value: 16, pct: true }]
 */
export function tokenize(raw) {
  const s = String(raw ?? '').replace(/\s+/g, '');
  if (!s) return [];
  const tokens = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];
    if (/\d|,/.test(ch)) {
      let numStr = '';
      while (i < s.length && /[\d,]/.test(s[i])) {
        numStr += s[i];
        i += 1;
      }
      const value = Number(numStr.replace(',', '.'));
      if (!Number.isFinite(value)) return [];
      let pct = false;
      if (s[i] === '%') {
        pct = true;
        i += 1;
      }
      tokens.push({ type: 'num', value, pct });
      continue;
    }

    const op = normalizeOperator(ch);
    if (op) {
      // Collapse consecutive operators, keeping the latest.
      if (tokens.length > 0 && tokens[tokens.length - 1].type === 'op') {
        tokens[tokens.length - 1].value = op;
      } else if (tokens.length > 0) {
        tokens.push({ type: 'op', value: op });
      }
      i += 1;
      continue;
    }

    // Stray % without a number or unknown char: skip.
    i += 1;
  }

  // Drop trailing operator so live conversion works while typing (e.g. "25+" -> 25).
  while (tokens.length > 0 && tokens[tokens.length - 1].type === 'op') {
    tokens.pop();
  }
  return tokens;
}

/**
 * Evaluates a keypad expression string to a finite non-negative number (or 0 if invalid/empty).
 * Returns { value, error } where error is 'DIV_ZERO' on division by zero.
 */
export function evaluateExpression(raw) {
  const tokens = tokenize(raw);
  if (tokens.length === 0) return { value: 0, error: null };

  // First pass: resolve × and ÷ with precedence, converting standalone % to value/100.
  // Keep + and - percentages contextual (resolved against the running sum in pass 2).
  const terms = [];
  let idx = 0;

  function resolveTerm() {
    let first = tokens[idx++];
    let acc = first.pct ? first.value / 100 : first.value;
    let isSimplePct = first.pct;
    const rawPct = first.value;

    while (idx < tokens.length && tokens[idx].type === 'op' && (tokens[idx].value === '×' || tokens[idx].value === '÷')) {
      isSimplePct = false;
      const op = tokens[idx++].value;
      const rightTok = tokens[idx++];
      if (!rightTok) break;
      const rhs = rightTok.pct ? rightTok.value / 100 : rightTok.value;
      if (op === '×') {
        acc *= rhs;
      } else {
        if (rhs === 0) return { error: 'DIV_ZERO' };
        acc /= rhs;
      }
    }
    return { acc, isSimplePct, rawPct, error: null };
  }

  const firstTerm = resolveTerm();
  if (firstTerm.error) return { value: 0, error: firstTerm.error };
  terms.push({ op: '+', ...firstTerm });

  while (idx < tokens.length) {
    const op = tokens[idx++].value; // '+' or '-'
    if (idx >= tokens.length) break;
    const term = resolveTerm();
    if (term.error) return { value: 0, error: term.error };
    terms.push({ op, ...term });
  }

  // Second pass: sum/subtract terms. A single percentage term after +/- applies to the running total.
  let total = terms[0].acc;
  for (let i = 1; i < terms.length; i += 1) {
    const t = terms[i];
    const delta = t.isSimplePct ? total * (t.rawPct / 100) : t.acc;
    total = t.op === '+' ? total + delta : total - delta;
  }

  if (!Number.isFinite(total)) return { value: 0, error: 'INVALID' };
  return { value: Math.max(0, total), error: null };
}

/** Formats an expression string with Venezuelan thousands grouping on each numeric segment. */
export function formatExpression(input, formatNumPart) {
  if (!input) return '0';
  return String(input).replace(/\d+(?:,\d*)?/g, (segment) => formatNumPart(segment))
    .replace(/([+\-×÷])/g, ' $1 ');
}

/**
 * Applies a keypad press to an expression string.
 * Supports digits, ',', 'back', 'clear', operators (+, -, ×, ÷), '%', and '='.
 */
export function applyExprKey(input, key, { maxIntDigits = 12, maxDecimals = 2, formatResult } = {}) {
  const s = String(input ?? '');
  if (key === 'clear') return '';
  if (key === 'back') return s.slice(0, -1);

  if (key === '=') {
    if (!s) return '';
    const { value, error } = evaluateExpression(s);
    if (error) return s;
    return formatResult ? formatResult(value) : String(value);
  }

  const op = normalizeOperator(key);
  if (op) {
    if (!s) return '';
    const last = s[s.length - 1];
    if (last === ',') return s.slice(0, -1) + op;
    if (normalizeOperator(last)) return s.slice(0, -1) + op;
    return s + op;
  }

  if (key === '%') {
    if (!s) return '';
    const last = s[s.length - 1];
    if (last === '%' || normalizeOperator(last) || last === ',') return s;
    return `${s}%`;
  }

  // Find the active numeric segment after the last operator.
  const lastOpIdx = Math.max(s.lastIndexOf('+'), s.lastIndexOf('-'), s.lastIndexOf('×'), s.lastIndexOf('÷'));
  const prefix = lastOpIdx === -1 ? '' : s.slice(0, lastOpIdx + 1);
  const seg = lastOpIdx === -1 ? s : s.slice(lastOpIdx + 1);

  // Don't append digits directly after '%'; user must type an operator first.
  if (seg.endsWith('%')) return s;

  const [intPart, decPart] = seg.split(',');
  if (key === ',') {
    return decPart !== undefined ? s : `${prefix}${intPart || '0'},`;
  }
  if (!/^\d$/.test(key)) return s;
  if (decPart !== undefined) {
    return decPart.length >= maxDecimals ? s : s + key;
  }
  if (intPart === '0') return prefix + key;
  return intPart.length >= maxIntDigits ? s : s + key;
}

/** Validates whether a stored keypad string is a safe expression. */
export function isValidExprString(text) {
  return typeof text === 'string' && text.length <= 80 && /^[\d,+\-×÷%]*$/.test(text);
}
