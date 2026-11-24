/** Safe arithmetic evaluator (no eval). Supports + - * / % ^, parentheses, percentages,
 *  constants (pi, e) and common functions. Small local models are bad at math — this isn't. */

const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  log: Math.log10, ln: Math.log, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const tokens = [];
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/,(?=\d{3}\b)/g, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (num) {
      tokens.push({ t: 'num', v: parseFloat(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = s.slice(i).match(/^[a-z_]+/i);
    if (id) {
      tokens.push({ t: 'id', v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ('+-*/%^(),'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return tokens;
}

export function calculate(expression) {
  const tokens = tokenize(String(expression));
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (v) => {
    const tok = tokens[pos];
    if (v !== undefined && (!tok || tok.v !== v)) throw new Error(`Expected "${v}"`);
    pos++;
    return tok;
  };

  function expr() {
    let left = term();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const op = take().v;
      const right = term();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function term() {
    let left = unary();
    while (peek() && ['*', '/', '%'].includes(peek().v)) {
      const op = take().v;
      // "15% of 200" style: a bare % followed by "of"
      if (op === '%' && peek()?.v === 'of') {
        take();
        left = (left / 100) * unary();
        continue;
      }
      if (op === '%' && (!peek() || [')', '+', '-', ','].includes(peek().v))) {
        left = left / 100;
        continue;
      }
      const right = unary();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      } else left %= right;
    }
    return left;
  }
  function unary() {
    if (peek()?.v === '-') {
      take();
      return -unary();
    }
    if (peek()?.v === '+') {
      take();
      return unary();
    }
    return power();
  }
  function power() {
    const base = primary();
    if (peek()?.v === '^') {
      take();
      return base ** unary();
    }
    return base;
  }
  function primary() {
    const tok = take();
    if (!tok) throw new Error('Unexpected end of expression');
    if (tok.t === 'num') return tok.v;
    if (tok.v === '(') {
      const v = expr();
      take(')');
      return v;
    }
    if (tok.t === 'id') {
      if (tok.v in CONSTS) return CONSTS[tok.v];
      if (tok.v in FUNCS) {
        take('(');
        const args = [expr()];
        while (peek()?.v === ',') {
          take();
          args.push(expr());
        }
        take(')');
        return FUNCS[tok.v](...args);
      }
      throw new Error(`Unknown name "${tok.v}"`);
    }
    throw new Error(`Unexpected "${tok.v}"`);
  }

  const result = expr();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].v}"`);
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return Math.round(result * 1e10) / 1e10;
}
