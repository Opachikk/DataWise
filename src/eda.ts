import type { Dataset, Row } from './data';

export type ColType = 'number' | 'date' | 'boolean' | 'category' | 'text' | 'id' | 'empty';
export type NumStats = {
  mean: number; std: number; min: number; q1: number; median: number; q3: number; max: number; skew: number;
  outliers: number; zeros: number; negatives: number; bins: number[]; lo: number; hi: number; clipped: boolean;
};
export type ColProfile = {
  name: string; type: ColType; count: number; missing: number; missingPct: number; distinct: number;
  constant: boolean; bad: number; topShare: number; num?: NumStats; top?: { value: string; count: number }[];
  dates?: { min: string; max: string; spanDays: number; unit: 'month' | 'year'; buckets: { label: string; count: number }[] };
  avgLen?: number;
};
export type Insight = { text: string; level: 'warn' | 'info'; score: number };
export type Pair = { a: string; b: string; r: number; n: number };
export type Profile = {
  rows: number; cols: number; missingCells: number; missingPct: number; dupRows: number;
  columns: ColProfile[]; typeCounts: Partial<Record<ColType, number>>;
  corr: { cols: string[]; matrix: (number | null)[][]; pairs: Pair[]; truncated: boolean };
  insights: Insight[];
};

const ID_LIKE = /(^|[\s_-])(id|key|code|sku|uuid|ref|number|no|email)($|[\s_-])|id$/i;
const NUM_RE = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][-+]?\d+)?$|^[-+]?\.\d+$/;
const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const BOOL = new Set(['true', 'false', 'yes', 'no', 'y', 'n', 't', 'f', '0', '1']);

export function fmtNum(x: number): string {
  if (!Number.isFinite(x)) return '–';
  const a = Math.abs(x);
  if (a >= 1000) return x.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 1) return x.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a === 0) return '0';
  return x.toLocaleString('en-US', { maximumSignificantDigits: 3 });
}
export const fmtPct = (x: number) => (x > 0 && x < 0.1 ? '<0.1%' : `${x < 10 ? x.toFixed(1) : Math.round(x)}%`);
const toNum = (v: string) => Number(v.replace(/,/g, ''));
const q = (sorted: Float64Array, p: number) => {
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

function parseDate(v: string): number | null {
  const m = DATE_RE.exec(v); if (!m) return null;
  const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

function inferType(name: string, vals: string[], distinct: Set<string>): ColType {
  const n = vals.length; if (!n) return 'empty';
  if (distinct.size <= 2 && [...distinct].every(v => BOOL.has(v.toLowerCase()))) return 'boolean';
  if (n >= 5 && ID_LIKE.test(name) && distinct.size / n >= 0.9) return 'id';
  let nums = 0, dates = 0;
  for (const v of vals) { if (NUM_RE.test(v)) nums++; else if (parseDate(v) !== null) dates++; }
  if (nums / n >= 0.95) return 'number';
  if (dates / n >= 0.95) return 'date';
  if ((distinct.size <= 30 && distinct.size <= n * 0.5) || distinct.size / n <= 0.05) return 'category';
  return 'text';
}

function numStats(xs: Float64Array): NumStats {
  const n = xs.length; const sorted = Float64Array.from(xs).sort();
  let sum = 0, zeros = 0, neg = 0; for (const x of xs) { sum += x; if (x === 0) zeros++; if (x < 0) neg++; }
  const mean = sum / n; let ss = 0, s3 = 0; for (const x of xs) { const d = x - mean; ss += d * d; s3 += d * d * d; }
  const std = n > 1 ? Math.sqrt(ss / (n - 1)) : 0; const popStd = Math.sqrt(ss / n);
  const skew = popStd > 0 ? s3 / n / (popStd ** 3) : 0;
  const q1 = q(sorted, 0.25), median = q(sorted, 0.5), q3 = q(sorted, 0.75), iqr = q3 - q1;
  let outliers = 0; if (iqr > 0) for (const x of xs) if (x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr) outliers++;
  const min = sorted[0], max = sorted[n - 1];
  let lo = min, hi = max, clipped = false;
  if (n >= 50) { const p1 = q(sorted, 0.01), p99 = q(sorted, 0.99); if (p99 > p1 && max - min > 4 * (p99 - p1)) { lo = p1; hi = p99; clipped = true; } }
  const bins = new Array(12).fill(0); const w = (hi - lo) / 12 || 1;
  for (const x of xs) bins[Math.min(11, Math.max(0, Math.floor((x - lo) / w)))]++;
  return { mean, std, min, q1, median, q3, max, skew, outliers, zeros, negatives: neg, bins, lo, hi, clipped };
}

export function profileDataset(data: Dataset): Profile {
  const n = data.rows.length;
  const columns: ColProfile[] = []; const numArrays = new Map<string, Float64Array>();
  let missingCells = 0;

  for (const name of data.columns) {
    const vals: string[] = [];
    const full = new Array<string>(n);
    for (let i = 0; i < n; i++) { const v = String(data.rows[i][name] ?? '').trim(); full[i] = v; if (v) vals.push(v); }
    const distinct = new Set(vals); const type = inferType(name, vals, distinct);
    const count = vals.length, missing = n - count; missingCells += missing;
    const counts = new Map<string, number>(); for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, c]) => ({ value, count: c }));
    const col: ColProfile = {
      name, type, count, missing, missingPct: n ? (missing / n) * 100 : 0, distinct: distinct.size,
      constant: distinct.size === 1 && count >= 2, bad: 0, topShare: count ? (top[0]?.count ?? 0) / count : 0,
    };
    if (type === 'number') {
      const xs: number[] = []; for (const v of vals) { if (NUM_RE.test(v)) xs.push(toNum(v)); else col.bad++; }
      if (xs.length) { col.num = numStats(Float64Array.from(xs)); }
      const arr = new Float64Array(n).fill(NaN); full.forEach((v, i) => { if (v && NUM_RE.test(v)) arr[i] = toNum(v); });
      numArrays.set(name, arr);
    } else if (type === 'date') {
      const ms: number[] = []; for (const v of vals) { const t = parseDate(v); if (t !== null) ms.push(t); else col.bad++; }
      ms.sort((a, b) => a - b);
      const spanDays = Math.round((ms[ms.length - 1] - ms[0]) / 86400000);
      const unit: 'month' | 'year' = spanDays <= 365 * 3 ? 'month' : 'year';
      const b = new Map<string, number>();
      for (const t of ms) { const d = new Date(t); const k = unit === 'month' ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : String(d.getUTCFullYear()); b.set(k, (b.get(k) ?? 0) + 1); }
      col.dates = { min: new Date(ms[0]).toISOString().slice(0, 10), max: new Date(ms[ms.length - 1]).toISOString().slice(0, 10), spanDays, unit, buckets: [...b].sort((x, y) => x[0].localeCompare(y[0])).map(([label, c]) => ({ label, count: c })) };
    } else if (type === 'category' || type === 'boolean' || type === 'text') {
      col.top = top.slice(0, type === 'text' ? 5 : 8);
      if (type === 'text') col.avgLen = vals.reduce((a, v) => a + v.length, 0) / (count || 1);
    }
    columns.push(col);
  }

  // duplicate rows
  const seen = new Set<string>(); let dupRows = 0;
  for (const r of data.rows) { const k = data.columns.map(c => String(r[c] ?? '').trim()).join('\u001f'); if (seen.has(k)) dupRows++; else seen.add(k); }

  // correlations
  const numCols = columns.filter(c => c.type === 'number' && c.num && c.num.std > 0).map(c => c.name);
  const used = numCols.slice(0, 12);
  const matrix: (number | null)[][] = used.map(() => used.map(() => null));
  const pairs: Pair[] = [];
  for (let i = 0; i < used.length; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < used.length; j++) {
      const a = numArrays.get(used[i])!, b = numArrays.get(used[j])!;
      let m = 0, sa = 0, sb = 0; for (let k = 0; k < n; k++) if (!Number.isNaN(a[k]) && !Number.isNaN(b[k])) { m++; sa += a[k]; sb += b[k]; }
      if (m < 10) continue;
      const ma = sa / m, mb = sb / m; let sxy = 0, sxx = 0, syy = 0;
      for (let k = 0; k < n; k++) if (!Number.isNaN(a[k]) && !Number.isNaN(b[k])) { const dx = a[k] - ma, dy = b[k] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      if (sxx === 0 || syy === 0) continue;
      const r = sxy / Math.sqrt(sxx * syy); matrix[i][j] = matrix[j][i] = r; pairs.push({ a: used[i], b: used[j], r, n: m });
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  const typeCounts: Partial<Record<ColType, number>> = {}; columns.forEach(c => { typeCounts[c.type] = (typeCounts[c.type] ?? 0) + 1; });
  const cells = n * data.columns.length;
  const profile: Profile = {
    rows: n, cols: data.columns.length, missingCells, missingPct: cells ? (missingCells / cells) * 100 : 0, dupRows, columns, typeCounts,
    corr: { cols: used, matrix, pairs, truncated: numCols.length > 12 }, insights: [],
  };
  profile.insights = buildInsights(profile);
  return profile;
}

export const strength = (r: number) => { const a = Math.abs(r); return a >= 0.8 ? 'very strong' : a >= 0.6 ? 'strong' : a >= 0.4 ? 'moderate' : 'weak'; };

function buildInsights(p: Profile): Insight[] {
  const out: Insight[] = []; const n = p.rows;
  for (const c of p.columns) {
    if (c.type === 'empty') { out.push({ level: 'warn', score: 70, text: `“${c.name}” is completely empty.` }); continue; }
    if (c.missingPct >= 5) out.push({ level: 'warn', score: 40 + c.missingPct / 2, text: `“${c.name}” is ${fmtPct(c.missingPct)} empty (${c.missing.toLocaleString()} of ${n.toLocaleString()} rows).` });
    if (c.constant) out.push({ level: 'info', score: 35, text: `“${c.name}” has the same value in every row, so it tells you nothing about differences between rows.` });
    if (c.type === 'id' && c.distinct < c.count) out.push({ level: 'warn', score: 55, text: `“${c.name}” looks like an ID, but ${(c.count - c.distinct).toLocaleString()} value${c.count - c.distinct === 1 ? '' : 's'} repeat${c.count - c.distinct === 1 ? 's' : ''}.` });
    if (c.bad > 0) out.push({ level: 'warn', score: 50, text: `“${c.name}” is mostly ${c.type === 'number' ? 'numbers' : 'dates'}, but ${c.bad.toLocaleString()} entr${c.bad === 1 ? 'y is' : 'ies are'} not.` });
    if (c.num && c.count >= 30) {
      const s = c.num;
      if (Math.abs(s.skew) >= 1.5 && s.std > 0) out.push({ level: 'info', score: 30 + Math.min(20, Math.abs(s.skew) * 3), text: `“${c.name}” is lopsided: the average is ${fmtNum(s.mean)} but the median is ${fmtNum(s.median)}, because ${s.skew > 0 ? 'a few very large' : 'a few very small'} values pull it. The median is the better “typical” number.` });
      const share = (s.outliers / c.num.bins.reduce((a, b) => a + b, 0)) * 100;
      if (share >= 1) out.push({ level: 'info', score: 25 + share, text: `${s.outliers.toLocaleString()} values in “${c.name}” (${fmtPct(share)}) are far from the rest. Check whether they are real before using averages.` });
    }
    if ((c.type === 'category') && c.topShare >= 0.8 && !c.constant && c.top) out.push({ level: 'info', score: 33, text: `${fmtPct(c.topShare * 100)} of rows in “${c.name}” are “${c.top[0].value}”. The other values are rare.` });
    if (c.dates) out.push({ level: 'info', score: 10, text: `“${c.name}” covers ${c.dates.min} to ${c.dates.max} (${c.dates.spanDays >= 730 ? `${(c.dates.spanDays / 365).toFixed(1)} years` : `${c.dates.spanDays.toLocaleString()} days`}).` });
  }
  if (p.dupRows > 0) out.push({ level: 'warn', score: 65, text: (p.dupRows === 1 ? '1 row is an exact copy of another row.' : `${p.dupRows.toLocaleString()} rows are exact copies of another row.`) + ' SheetCheck can remove them.' });
  for (const pr of p.corr.pairs.filter(x => Math.abs(x.r) >= 0.6).slice(0, 3)) out.push({ level: 'info', score: 35 + Math.abs(pr.r) * 15, text: `“${pr.a}” and “${pr.b}” ${pr.r > 0 ? 'tend to rise together' : 'tend to move in opposite directions'} (${strength(pr.r)}, r = ${pr.r.toFixed(2)}).` });
  if (!out.some(i => i.level === 'warn')) out.push({ level: 'info', score: 5, text: 'No big problems stood out: no column is more than 5% empty and there are no duplicate rows.' });
  return out.sort((a, b) => b.score - a.score);
}

export function summaryRows(p: Profile): Row[] {
  return p.columns.map(c => ({
    Column: c.name, Type: c.type, 'Filled': String(c.count), Empty: String(c.missing), 'Empty %': c.missingPct.toFixed(1), Distinct: String(c.distinct),
    Min: c.num ? String(c.num.min) : c.dates?.min ?? '', Median: c.num ? String(c.num.median) : '', Mean: c.num ? c.num.mean.toFixed(4) : '',
    Max: c.num ? String(c.num.max) : c.dates?.max ?? '', 'Std dev': c.num ? c.num.std.toFixed(4) : '',
    'Most common': c.top?.[0]?.value ?? '', 'Most common %': c.top ? (c.topShare * 100).toFixed(1) : '',
  }));
}
export const SUMMARY_COLUMNS = ['Column', 'Type', 'Filled', 'Empty', 'Empty %', 'Distinct', 'Min', 'Median', 'Mean', 'Max', 'Std dev', 'Most common', 'Most common %'];
