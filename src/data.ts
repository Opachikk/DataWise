import Papa from 'papaparse';

export type Row = Record<string, string>;
export type Dataset = { name: string; columns: string[]; rows: Row[]; file?: File; sheets?: string[]; sheet?: string };

function toDataset(name: string, result: Papa.ParseResult<Row>): Dataset {
  const columns = result.meta.fields;
  if (!columns?.length) throw new Error('No column headers found. Add a header row and try again.');
  const rows = result.data.filter(row => Object.values(row).some(v => String(v ?? '').trim() !== ''));
  return { name, columns, rows };
}
const opts = { header: true, skipEmptyLines: 'greedy' as const, transformHeader: (h: string) => h.trim() };

export function parseCsv(file: File): Promise<Dataset> {
  return new Promise((resolve, reject) => Papa.parse<Row>(file, {
    ...opts,
    complete: result => { try { resolve(toDataset(file.name, result)); } catch (e) { reject(e); } },
    error: error => reject(error),
  }));
}
export function parseText(name: string, text: string): Dataset {
  return toDataset(name, Papa.parse<Row>(text, opts));
}

const norm = (v: unknown) => String(v ?? '').trim();


/* ---------- File reading (CSV + Excel) ---------- */
export const ACCEPT = '.csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const SUPPORTED = /\.(csv|tsv|txt|xlsx|xls)$/i;
type SheetCache = { sheet: string; data: unknown[][] }[];
const sheetCache = new WeakMap<File, SheetCache>();

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) { const iso = new Date(Math.round(v.getTime() / 1000) * 1000).toISOString(); return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' '); }
  return String(v);
};

async function parseXlsx(file: File, sheet?: string): Promise<Dataset> {
  let sheets = sheetCache.get(file);
  if (!sheets) {
    const mod = await import('read-excel-file/browser');
    try { sheets = (await mod.default(file)) as unknown as SheetCache; }
    catch { throw new Error('Could not read this Excel file. If it is password-protected or damaged, save a fresh copy as .xlsx or .csv.'); }
    sheetCache.set(file, sheets);
  }
  if (!sheets.length) throw new Error('This workbook has no sheets.');
  const chosen = sheets.find(x => x.sheet === sheet) ?? sheets[0];
  const matrix = chosen.data;
  if (!matrix.length) throw new Error(`Sheet “${chosen.sheet}” is empty.`);
  const used = new Set<string>();
  const columns = (matrix[0] as unknown[]).map((h, i) => {
    let name = cellText(h).trim() || `Column ${i + 1}`; const base = name; let n = 2;
    while (used.has(name)) name = `${base}_${n++}`;
    used.add(name); return name;
  });
  const rows = matrix.slice(1).map(r => Object.fromEntries(columns.map((c, i) => [c, cellText((r as unknown[])[i])])) as Row)
    .filter(r => Object.values(r).some(v => v.trim() !== ''));
  return { name: file.name, columns, rows, file, sheets: sheets.map(x => x.sheet), sheet: chosen.sheet };
}

export async function parseFile(file: File, sheet?: string): Promise<Dataset> {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(file, sheet);
  if (/\.xls$/i.test(file.name)) throw new Error('Older .xls files are not supported. Open it in Excel or Google Sheets and save it as .xlsx or .csv.');
  return { ...(await parseCsv(file)), file };
}

/* ---------- SheetCheck ---------- */
export type FixKind = 'dedupe' | 'trim' | 'case' | 'drop-blank';
export type Issue = {
  id: string; column: string; kind: string; count: number; message: string;
  examples: string[]; rows: number[]; fix?: { kind: FixKind; label: string };
};

export function inspectData(data: Dataset): Issue[] {
  const issues: Issue[] = [];
  const n = data.rows.length;

  const seenRows = new Map<string, number>(); const dupRows: number[] = [];
  data.rows.forEach((row, i) => {
    const k = data.columns.map(c => norm(row[c])).join('\u001f');
    if (seenRows.has(k)) dupRows.push(i); else seenRows.set(k, i);
  });
  if (dupRows.length) issues.push({
    id: 'duplicate-rows', column: 'All columns', kind: 'Duplicate rows', count: dupRows.length,
    message: `${dupRows.length} complete rows repeat an earlier row.`, examples: [], rows: dupRows,
    fix: { kind: 'dedupe', label: 'Remove duplicates' },
  });

  for (const col of data.columns) {
    const raw = data.rows.map(r => String(r[col] ?? ''));
    const values = raw.map(v => v.trim());

    const blankRows = values.flatMap((v, i) => (v ? [] : [i]));
    if (blankRows.length) issues.push({
      id: `blank-${col}`, column: col, kind: 'Missing values', count: blankRows.length,
      message: `${blankRows.length.toLocaleString()} of ${n.toLocaleString()} rows have no value.`, examples: [], rows: blankRows,
      fix: { kind: 'drop-blank', label: 'Remove these rows' },
    });

    const wsRows = raw.flatMap((v, i) => (v !== v.trim() || /\s{2,}/.test(v) ? [i] : []));
    if (wsRows.length) issues.push({
      id: `space-${col}`, column: col, kind: 'Extra spaces', count: wsRows.length,
      message: `${wsRows.length} values have leading, trailing, or doubled spaces.`,
      examples: wsRows.slice(0, 3).map(i => `“${raw[i]}”`), rows: wsRows,
      fix: { kind: 'trim', label: 'Trim spaces' },
    });

    const filled = values.filter(Boolean);
    const distinct = new Set(filled);
    if (/(^|[\s_-])(id|key|code|sku|email|uuid|ref|number|no)($|[\s_-])|id$/i.test(col) && filled.length >= 5 && distinct.size / filled.length >= 0.9 && distinct.size < filled.length) {
      const seen = new Set<string>(); const rep: number[] = [];
      values.forEach((v, i) => { if (!v) return; if (seen.has(v)) rep.push(i); else seen.add(v); });
      issues.push({
        id: `repeat-${col}`, column: col, kind: 'Repeated IDs', count: rep.length,
        message: `Almost every value here is unique, but ${rep.length} repeat. If this is an identifier, check it.`,
        examples: [...new Set(rep.map(i => values[i]))].slice(0, 3), rows: rep,
      });
    }

    const groups = new Map<string, Map<string, number>>();
    values.forEach(v => {
      if (!v) return; const k = v.toLocaleLowerCase();
      const g = groups.get(k) ?? new Map<string, number>(); g.set(v, (g.get(v) ?? 0) + 1); groups.set(k, g);
    });
    const mixed = [...groups.values()].filter(g => g.size > 1);
    if (mixed.length) {
      const mixedKeys = new Set(mixed.flatMap(g => [...g.keys()]));
      const rows = values.flatMap((v, i) => (mixedKeys.has(v) ? [i] : []));
      issues.push({
        id: `case-${col}`, column: col, kind: 'Inconsistent capitalization', count: mixed.reduce((a, g) => a + g.size - 1, 0),
        message: `${mixed.length} value${mixed.length > 1 ? 's' : ''} appear in more than one capitalization.`,
        examples: mixed.slice(0, 2).map(g => [...g.keys()].join(' / ')), rows,
        fix: { kind: 'case', label: 'Use most common form' },
      });
    }

    if (filled.length > 3 && filled.every(v => !Number.isNaN(Number(v.replace(/,/g, ''))))) {
      const nums = filled.map(v => Number(v.replace(/,/g, ''))).sort((a, b) => a - b);
      const q1 = nums[Math.floor((nums.length - 1) * 0.25)], q3 = nums[Math.floor((nums.length - 1) * 0.75)], iqr = q3 - q1;
      if (iqr > 0) {
        const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
        const rows = values.flatMap((v, i) => { if (!v) return []; const x = Number(v.replace(/,/g, '')); return x < lo || x > hi ? [i] : []; });
        if (rows.length) issues.push({
          id: `outlier-${col}`, column: col, kind: 'Potential outliers', count: rows.length,
          message: `${rows.length.toLocaleString()} value${rows.length > 1 ? 's' : ''} ${rows.length > 1 ? 'are' : 'is'} far from the rest of this column.${rows.length / filled.length > 0.02 ? ' That is a lot, so the column is probably just spread out (prices often are) and most of these may be normal.' : ' They may still be correct.'} Review before changing.`,
          examples: rows.slice(0, 3).map(i => values[i]), rows,
        });
      }
    }
  }
  return issues;
}

export function applyFix(data: Dataset, rows: Row[], issue: Issue): Row[] {
  const col = issue.column;
  switch (issue.fix?.kind) {
    case 'dedupe': {
      const seen = new Set<string>();
      return rows.filter(r => { const k = data.columns.map(c => norm(r[c])).join('\u001f'); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    case 'drop-blank': return rows.filter(r => norm(r[col]) !== '');
    case 'trim': return rows.map(r => ({ ...r, [col]: String(r[col] ?? '').trim().replace(/\s{2,}/g, ' ') }));
    case 'case': {
      const counts = new Map<string, Map<string, number>>();
      rows.forEach(r => { const v = norm(r[col]); if (!v) return; const k = v.toLocaleLowerCase(); const g = counts.get(k) ?? new Map(); g.set(v, (g.get(v) ?? 0) + 1); counts.set(k, g); });
      const best = new Map<string, string>();
      counts.forEach((g, k) => best.set(k, [...g.entries()].sort((a, b) => b[1] - a[1])[0][0]));
      return rows.map(r => { const v = norm(r[col]); return v ? { ...r, [col]: best.get(v.toLocaleLowerCase()) ?? v } : r; });
    }
    default: return rows;
  }
}


/* ---------- One-click cleanup ---------- */
export type CleanOptions = { dedupe: boolean; trim: boolean; caseFix: boolean; missing: 'keep' | 'drop' | 'fill'; outliers: 'keep' | 'cap' | 'drop' };
export const DEFAULT_CLEAN: CleanOptions = { dedupe: true, trim: true, caseFix: true, missing: 'fill', outliers: 'keep' };
const ID_LIKE = /(^|[\s_-])(id|key|code|sku|email|uuid|ref|number|no)($|[\s_-])|id$/i;
const num = (v: string) => Number(v.replace(/,/g, ''));
const fmt = (x: number) => String(Math.round(x * 100) / 100);
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

export function cleanAll(data: Dataset, rows: Row[], o: CleanOptions): { rows: Row[]; steps: string[] } {
  let out = rows.map(r => ({ ...r }));
  const steps: string[] = [];
  const numCols = (min: number) => data.columns.filter(c => {
    const f = out.map(r => norm(r[c])).filter(Boolean);
    return f.length >= min && f.every(v => !Number.isNaN(num(v)));
  });

  if (o.trim) {
    let n = 0;
    out = out.map(r => { const nr = { ...r }; for (const c of data.columns) { const v = String(r[c] ?? ''); const t = v.trim().replace(/\s{2,}/g, ' '); if (t !== v) { nr[c] = t; n++; } } return nr; });
    if (n) steps.push(`Trimmed extra spaces in ${plural(n, 'cell')}`);
  }
  if (o.caseFix) {
    let n = 0;
    for (const c of data.columns) {
      const next = applyFix(data, out, { column: c, fix: { kind: 'case', label: '' } } as Issue);
      next.forEach((r, i) => { if (r[c] !== out[i][c]) n++; });
      out = next;
    }
    if (n) steps.push(`Standardized capitalization in ${plural(n, 'cell')}`);
  }
  if (o.dedupe) {
    const before = out.length;
    out = applyFix(data, out, { fix: { kind: 'dedupe', label: '' } } as Issue);
    if (before !== out.length) steps.push(`Removed ${plural(before - out.length, 'duplicate row')}`);
  }
  if (o.missing === 'drop') {
    const before = out.length;
    out = out.filter(r => data.columns.every(c => norm(r[c]) !== ''));
    if (before !== out.length) steps.push(`Removed ${plural(before - out.length, 'row')} with missing values`);
  }
  if (o.missing === 'fill') {
    const nc = new Set(numCols(1)); let n = 0; const details: string[] = []; const skipped: string[] = [];
    for (const c of data.columns) {
      const blanks = out.filter(r => norm(r[c]) === '').length;
      if (!blanks) continue;
      if (ID_LIKE.test(c)) { skipped.push(c); continue; }
      let fillValue = 'Unknown';
      if (nc.has(c)) {
        const nums = out.map(r => norm(r[c])).filter(Boolean).map(num).sort((a, b) => a - b);
        const mid = Math.floor(nums.length / 2);
        fillValue = fmt(nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2);
      }
      out = out.map(r => (norm(r[c]) === '' ? { ...r, [c]: fillValue } : r));
      n += blanks; details.push(`${c}: ${fillValue}`);
    }
    if (n) steps.push(`Filled ${plural(n, 'missing value')} (${details.join(', ')})`);
    if (skipped.length) steps.push(`Left blanks in ID-like columns (${skipped.join(', ')}) because they can’t be guessed`);
  }
  if (o.outliers !== 'keep') {
    const bounds = (c: string): [number, number] | null => {
      const nums = out.map(r => norm(r[c])).filter(Boolean).map(num).sort((x, y) => x - y);
      if (nums.length < 4) return null;
      const q1 = nums[Math.floor((nums.length - 1) * 0.25)], q3 = nums[Math.floor((nums.length - 1) * 0.75)], iqr = q3 - q1;
      return iqr > 0 ? [q1 - 3 * iqr, q3 + 3 * iqr] : null; // only clearly extreme values; the checker's 1.5× is stricter
    };
    const cols = numCols(4);
    if (o.outliers === 'cap') {
      for (const c of cols) {
        const hit = new Set<number>();
        for (let pass = 0; pass < 1; pass++) {
          const bd = bounds(c); if (!bd) break; let changed = false;
          out = out.map((r, i) => { const v = norm(r[c]); if (!v) return r; const x = num(v); if (x < bd[0] || x > bd[1]) { hit.add(i); changed = true; return { ...r, [c]: fmt(x < bd[0] ? bd[0] : bd[1]) }; } return r; });
          if (!changed) break;
        }
        if (hit.size) steps.push(`Capped ${plural(hit.size, 'outlier')} in “${c}” to the allowed range`);
      }
    } else {
      const start = out.length;
      for (let pass = 0; pass < 1; pass++) {
        const bd = new Map(cols.flatMap(c => { const b = bounds(c); return b ? [[c, b] as const] : []; }));
        const next = out.filter(r => ![...bd].some(([c, [lo, hi]]) => { const v = norm(r[c]); if (!v) return false; const x = num(v); return x < lo || x > hi; }));
        if (next.length === out.length) break; out = next;
      }
      if (start !== out.length) steps.push(`Removed ${plural(start - out.length, 'row')} with outlier values`);
    }
  }
  return { rows: out, steps };
}

/* ---------- Diffly ---------- */
export type Difference = { key: string; status: 'Added' | 'Removed' | 'Changed' | 'Unchanged'; before?: Row; after?: Row; changedColumns: string[] };
export type Comparison = {
  diffs: Difference[]; columns: string[];
  dupOld: number; dupNew: number; blankOld: number; blankNew: number;
  onlyOldCols: string[]; onlyNewCols: string[];
};

function indexByKey(rows: Row[], key: string) {
  const map = new Map<string, Row>(); let dups = 0, blanks = 0;
  rows.forEach(row => { const k = norm(row[key]); if (!k) { blanks++; return; } if (map.has(k)) dups++; else map.set(k, row); });
  return { map, dups, blanks };
}

export function compareData(oldData: Dataset, newData: Dataset, keyColumn: string): Comparison {
  const o = indexByKey(oldData.rows, keyColumn), nw = indexByKey(newData.rows, keyColumn);
  const columns = [...new Set([...oldData.columns, ...newData.columns])].filter(c => c !== keyColumn);
  const diffs: Difference[] = [...new Set([...o.map.keys(), ...nw.map.keys()])].map(key => {
    const before = o.map.get(key), after = nw.map.get(key);
    if (!before) return { key, status: 'Added', after, changedColumns: [] };
    if (!after) return { key, status: 'Removed', before, changedColumns: [] };
    const changedColumns = columns.filter(c => norm(before[c]) !== norm(after[c]));
    return { key, status: changedColumns.length ? 'Changed' : 'Unchanged', before, after, changedColumns };
  });
  return {
    diffs, columns, dupOld: o.dups, dupNew: nw.dups, blankOld: o.blanks, blankNew: nw.blanks,
    onlyOldCols: oldData.columns.filter(c => !newData.columns.includes(c)),
    onlyNewCols: newData.columns.filter(c => !oldData.columns.includes(c)),
  };
}

/** First shared column whose values are unique and non-blank in both files. */
export function suggestKey(a: Dataset, b: Dataset): string {
  const shared = a.columns.filter(c => b.columns.includes(c));
  const unique = (d: Dataset, c: string) => { const v = d.rows.map(r => norm(r[c])); return v.length > 0 && v.every(Boolean) && new Set(v).size === v.length; };
  return shared.find(c => unique(a, c) && unique(b, c)) ?? '';
}

export function comparisonRows(cmp: Comparison, key: string, diffs: Difference[]): Row[] {
  return diffs.map(d => {
    const out: Row = { [key]: d.key, Status: d.status, 'Changed columns': d.changedColumns.join('; ') };
    cmp.columns.forEach(c => { out[`Old: ${c}`] = d.before?.[c] ?? ''; out[`New: ${c}`] = d.after?.[c] ?? ''; });
    return out;
  });
}

export function downloadCsv(filename: string, rows: Row[], columns?: string[]) {
  const csv = Papa.unparse(rows, columns ? { columns } : undefined);
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
