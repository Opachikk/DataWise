import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Download, FileSpreadsheet, GitCompareArrows, ScanSearch, Undo2, Upload, X } from 'lucide-react';
import Explore from './Explore';
import {
  ACCEPT, SUPPORTED, applyFix, cleanAll, compareData, comparisonRows, DEFAULT_CLEAN, downloadCsv, inspectData, parseFile, suggestKey,
  type CleanOptions, type Dataset, type Difference, type Issue, type Row,
} from './data';

type Mode = 'home' | 'check' | 'diff' | 'explore';
type Slot = 'single' | 'left' | 'right';
const PAGE = 25;
const GSHEETS = 'Using Google Sheets? Choose File, Download, then Microsoft Excel (.xlsx) or CSV, and drop the file here.';
const HELP: Record<string, string> = { All: 'Every matched record', Changed: 'In both files, with at least one different value', Added: 'Only in the Updated file', Removed: 'Only in the Original file', Unchanged: 'Identical in both files' };
const STATUSES = ['All', 'Changed', 'Added', 'Removed', 'Unchanged'] as const;

export default function App() {
  const [mode, setMode] = useState<Mode>('home');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [working, setWorking] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [left, setLeft] = useState<Dataset | null>(null);
  const [right, setRight] = useState<Dataset | null>(null);
  const [keyColumn, setKeyColumn] = useState('');
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>('All');
  const [opts, setOpts] = useState<CleanOptions>(DEFAULT_CLEAN);
  const [report, setReport] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const [colFilter, setColFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showAllCols, setShowAllCols] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const nextRef = useRef<Mode>('check');
  const pickers = { single: useRef<HTMLInputElement>(null), left: useRef<HTMLInputElement>(null), right: useRef<HTMLInputElement>(null) };

  const rows = working ?? dataset?.rows ?? [];
  const current = useMemo<Dataset | null>(() => (dataset ? { ...dataset, rows } : null), [dataset, rows]);
  const issues = useMemo(() => (current ? inspectData(current) : []), [current]);
  const cmp = useMemo(() => (left && right && keyColumn ? compareData(left, right, keyColumn) : null), [left, right, keyColumn]);

  function place(slot: Slot, d: Dataset, nextMode?: Mode) {
    setError(''); setNote('');
    if (slot === 'single') { setDataset(d); setWorking(null); setSelected(null); setReport(null); }
    if (slot !== 'single') resetView();
    if (slot === 'left') { setLeft(d); setKeyColumn(right ? suggestKey(d, right) : ''); }
    if (slot === 'right') { setRight(d); setKeyColumn(left ? suggestKey(left, d) : ''); }
    if (nextMode) setMode(nextMode);
  }
  async function load(file: File | null | undefined, slot: Slot, nextMode?: Mode) {
    if (!file) return;
    if (!SUPPORTED.test(file.name)) { setError('DataWise reads CSV and Excel (.xlsx) files. Using Google Sheets? Download it as .xlsx or .csv first.'); return; }
    setBusy(true);
    try { place(slot, await parseFile(file), nextMode); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read this file.'); }
    finally { setBusy(false); }
  }
  const drop = (slot: Slot, nextMode?: Mode) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.currentTarget.classList.add('over'); },
    onDragLeave: (e: React.DragEvent) => e.currentTarget.classList.remove('over'),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.currentTarget.classList.remove('over'); load(e.dataTransfer.files?.[0], slot, nextMode); },
  });

  function fix(issue: Issue) {
    if (!dataset) return;
    const before = rows.length;
    const next = applyFix(dataset, rows, issue);
    setWorking(next); setSelected(null); setReport(null);
    const removed = before - next.length;
    setNote(`${issue.fix?.label}: ${removed > 0 ? `${removed} row${removed > 1 ? 's' : ''} removed` : 'values updated'}. Your original file is untouched.`);
  }
  function cleanEverything() {
    if (!dataset) return;
    const r = cleanAll(dataset, rows, opts);
    setWorking(r.rows); setReport(r.steps); setSelected(null); setNote('');
  }
  async function changeSheet(slot: Slot, sheet: string) {
    const d = slot === 'single' ? dataset : slot === 'left' ? left : right;
    if (!d?.file) return;
    try { place(slot, await parseFile(d.file, sheet)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not read that sheet.'); }
  }
  function sendToDiffly() {
    if (!dataset) return;
    const before: Dataset = { ...dataset, file: undefined, sheets: undefined };
    const after: Dataset = { ...dataset, name: `cleaned-${dataset.name}`, rows, file: undefined, sheets: undefined };
    setLeft(before); setRight(after); setKeyColumn(suggestKey(before, after)); resetView(); setError(''); setNote(''); setMode('diff');
  }
  function resetView() { setQuery(''); setColFilter(''); setPage(0); setFilter('All'); setExpanded(new Set()); }
  const openPicker = (m: Mode) => { nextRef.current = m; pickers.single.current?.click(); };
  function home() { setMode('home'); setError(''); setNote(''); }

  const shown = useMemo(() => {
    if (!cmp) return [] as Difference[];
    const q = query.trim().toLowerCase();
    return cmp.diffs.filter(d => (filter === 'All' || d.status === filter) && (!colFilter || d.changedColumns.includes(colFilter)) && (!q || d.key.toLowerCase().includes(q)));
  }, [cmp, filter, colFilter, query]);
  const colSummary = useMemo(() => {
    if (!cmp) return [];
    const m = new Map<string, { rows: number; pairs: Map<string, number> }>();
    cmp.diffs.forEach(d => d.changedColumns.forEach(c => {
      const e = m.get(c) ?? { rows: 0, pairs: new Map<string, number>() }; e.rows++;
      const k = `${d.before?.[c]?.trim() || 'empty'}\u0000${d.after?.[c]?.trim() || 'empty'}`;
      e.pairs.set(k, (e.pairs.get(k) ?? 0) + 1); m.set(c, e);
    }));
    return [...m].map(([col, e]) => { const top = [...e.pairs].sort((x, y) => y[1] - x[1])[0]; const [from, to] = top[0].split('\u0000'); return { col, rows: e.rows, from, to, n: top[1], distinct: e.pairs.size }; }).sort((x, y) => y.rows - x.rows);
  }, [cmp]);
  const likelyDupes = !!(left && right && cmp && cmp.dupOld > cmp.dupNew && left.rows.length - right.rows.length === cmp.dupOld - cmp.dupNew);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const pageRows = shown.slice(pg * PAGE, pg * PAGE + PAGE);
  const view = (fn: () => void) => { fn(); setPage(0); };
  const toggle = (k: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const peek = (r?: Row) => (r ? Object.entries(r).filter(([, v]) => v?.trim()).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ') : '');
  const count = (s: string) => cmp?.diffs.filter(d => d.status === s).length ?? 0;
  const issue = issues.find(i => i.id === selected) ?? null;
  const previewIdx = issue ? issue.rows.slice(0, 40) : rows.slice(0, 15).map((_, i) => i);

  return (
    <div className="shell">
      <header className="bar">
        <button className="mark" onClick={home}><img src="/favicon.svg" alt="" width="24" height="24" />DataWise</button>
        <nav className="tabs" aria-label="Tools">
          <button className={mode === 'check' ? 'on' : ''} onClick={() => setMode('check')}>SheetCheck</button>
          <button className={mode === 'diff' ? 'on' : ''} onClick={() => setMode('diff')}>Diffly</button>
          <button className={mode === 'explore' ? 'on' : ''} onClick={() => setMode('explore')}>Explore</button>
        </nav>
        <span className="bar-note">Files stay in your browser</span>
      </header>

      <main>
        {error && <div className="banner err" role="alert"><span>{error}</span><button aria-label="Dismiss" onClick={() => setError('')}><X size={15} /></button></div>}

        {mode === 'home' && (
          <div className="home">
            <div className="home-left">
              <h1>Make your data useful.</h1>
              <p className="lede">Drop in a CSV or Excel file. DataWise finds the blanks, duplicates, messy spacing and odd numbers, and can fix all of it in one click. Your file never leaves this browser tab.</p>
              <div className="drop" {...drop('single', 'check')}>
                <h2>Drop a CSV or Excel file here</h2>
                <div className="row-actions"><button className="btn primary" onClick={() => openPicker('check')}>Choose a file</button></div>
                <p className="hint">{GSHEETS}</p>
              </div>
              <p className="alt">Want the big picture first? <button className="link" onClick={() => { setMode('explore'); openPicker('explore'); }}>Explore a dataset</button> for a one-page summary. Got two versions of the same file? <button className="link" onClick={() => setMode('diff')}>Compare them with Diffly</button>.</p>
            </div>
            <figure className="sheet">
              <table>
                <thead><tr><th>id</th><th>name</th><th>dept</th><th>salary</th><th></th></tr></thead>
                <tbody>
                  <tr><td>1</td><td>Asha Rao</td><td>Sales</td><td>52000</td><td></td></tr>
                  <tr><td>2</td><td>Ben Carter</td><td className="hl">sales</td><td>48000</td><td className="note">inconsistent case</td></tr>
                  <tr><td>3</td><td>Chen Li</td><td>Eng</td><td>91000</td><td></td></tr>
                  <tr className="hl"><td>3</td><td>Chen Li</td><td>Eng</td><td>91000</td><td className="note">duplicate row</td></tr>
                  <tr><td>4</td><td>Dara Okafor</td><td>Eng</td><td className="hl"></td><td className="note">missing</td></tr>
                  <tr><td>5</td><td className="hl">··Elena Petrova</td><td>Mktg</td><td>58000</td><td className="note">extra spaces</td></tr>
                  <tr><td>7</td><td>Gita Nair</td><td>Sales</td><td className="hl">4900000</td><td className="note">outlier?</td></tr>
                </tbody>
              </table>
              <figcaption>What SheetCheck marks up. Review each one, or clear them all at once.</figcaption>
            </figure>
          </div>
        )}

        {mode === 'check' && (
          <section>
            {!dataset || !current ? (
              <div className="drop" {...drop('single')}>
                <Upload size={22} />
                <h2>{busy ? 'Reading file…' : 'Open a CSV or Excel file to inspect'}</h2>
                <p>Drop it here, or choose a file. It never leaves this device.</p>
                <div className="row-actions"><button className="btn primary" onClick={() => openPicker('check')}>Choose a file</button></div>
                <p className="hint">{GSHEETS}</p>
              </div>
            ) : (
              <>
                <div className="filebar">
                  <FileSpreadsheet size={18} />
                  <div className="fname"><b>{dataset.name}</b><span>{rows.length.toLocaleString()} rows, {dataset.columns.length} columns{dataset.sheet && dataset.sheets && dataset.sheets.length > 1 ? `, sheet “${dataset.sheet}”` : ''}{working && rows.length !== dataset.rows.length ? ` (was ${dataset.rows.length.toLocaleString()})` : ''}</span></div>
                  <div className="row-actions">
                    {dataset.sheets && dataset.sheets.length > 1 && <label className="sheetpick">Sheet <select value={dataset.sheet} onChange={e => changeSheet('single', e.target.value)}>{dataset.sheets.map(n => <option key={n}>{n}</option>)}</select></label>}
                    {working && <button className="btn" onClick={() => { setWorking(null); setNote(''); setSelected(null); setReport(null); }}><Undo2 size={15} /> Undo all changes</button>}
                    <button className="btn" onClick={() => openPicker('check')}>Replace</button>
                    <button className="btn" onClick={sendToDiffly}><GitCompareArrows size={15} /> Compare in Diffly</button>
                    <button className="btn primary" onClick={() => downloadCsv(`cleaned-${dataset.name}`, rows, dataset.columns)}><Download size={15} /> Export CSV</button>
                  </div>
                </div>
                {note && <div className="banner ok"><Check size={15} /><span>{note}</span></div>}
                <div className="cleaner">
                  <div className="cleaner-top">
                    <div><h2>Fix everything at once</h2><p className="sub">Works on a copy. Your original file isn’t touched and you can undo.</p></div>
                    <button className="btn primary big" onClick={cleanEverything} disabled={!issues.length}>{issues.length ? 'Clean my data' : 'Already clean'}</button>
                  </div>
                  <div className="opts">
                    <label><input type="checkbox" checked={opts.dedupe} onChange={e => setOpts({ ...opts, dedupe: e.target.checked })} /> Remove duplicate rows</label>
                    <label><input type="checkbox" checked={opts.trim} onChange={e => setOpts({ ...opts, trim: e.target.checked })} /> Trim extra spaces</label>
                    <label><input type="checkbox" checked={opts.caseFix} onChange={e => setOpts({ ...opts, caseFix: e.target.checked })} /> Match capitalization</label>
                    <label>Missing values <select value={opts.missing} onChange={e => setOpts({ ...opts, missing: e.target.value as CleanOptions['missing'] })}>
                      <option value="fill">Fill in (median / “Unknown”)</option><option value="drop">Remove those rows</option><option value="keep">Leave alone</option></select></label>
                    <label>Outliers <select value={opts.outliers} onChange={e => setOpts({ ...opts, outliers: e.target.value as CleanOptions['outliers'] })}>
                      <option value="keep">Leave alone</option><option value="cap">Pull extreme values back</option><option value="drop">Remove those rows</option></select></label>
                  </div>
                  <p className="sub optnote">{opts.missing === 'fill' && 'Blank numbers get the middle value of their column (the median) and blank text becomes “Unknown”. '}{opts.missing === 'drop' && 'Any row with a blank cell is deleted. '}{opts.outliers === 'cap' && 'Extremely high or low numbers are pulled back to the nearest normal value, not deleted.'}{opts.outliers === 'drop' && 'Rows containing extreme numbers are deleted.'}</p>
                  {report && (
                    <div className="report">
                      <h3>{report.length ? 'Done. Here’s what changed:' : 'Nothing needed changing.'}</h3>
                      {report.length > 0 && <ul>{report.map(r => <li key={r}>{r}</li>)}</ul>}
                      <div className="row-actions">
                        <button className="btn primary" onClick={() => downloadCsv(`cleaned-${dataset.name}`, rows, dataset.columns)}><Download size={15} /> Download clean CSV</button>
                        <button className="btn" onClick={sendToDiffly}><GitCompareArrows size={15} /> Compare with the original</button>
                      </div>
                      <p className="sub">Filled and capped values are estimates. Anything still flagged on the left, such as outliers, needs your own judgment.</p>
                    </div>
                  )}
                </div>

                <div className="bench">
                  <div className="findings">
                    <h2>{issues.length ? `${issues.length} thing${issues.length > 1 ? 's' : ''} to review` : 'Nothing to flag'}</h2>
                    <p className="sub">Checks are heuristics. Select a finding to see the affected rows.</p>
                    {issues.length === 0 && <p className="clear"><Check size={16} /> No missing values, duplicates, spacing, capitalization, or outlier issues found.</p>}
                    <ul>
                      {issues.map(i => (
                        <li key={i.id} className={i.id === selected ? 'sel' : ''}>
                          <button className="finding" onClick={() => setSelected(i.id === selected ? null : i.id)} aria-pressed={i.id === selected}>
                            <span className="count">{i.count.toLocaleString()}</span>
                            <span className="ftext"><b>{i.kind}</b><span className="col">{i.column}</span><span className="msg">{i.message}</span>{i.examples.length > 0 && <span className="ex">e.g. {i.examples.join(', ')}</span>}</span>
                          </button>
                          {i.fix ? <button className="btn small" onClick={() => fix(i)}>{i.fix.label}</button> : <span className="review">Review only</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="preview">
                    <div className="preview-head"><h2>{issue ? `${issue.kind}: ${issue.column}` : 'Preview'}</h2><span>{issue ? `${Math.min(40, issue.rows.length)} of ${issue.rows.length} affected rows` : `first ${Math.min(15, rows.length)} of ${rows.length.toLocaleString()} rows`}</span></div>
                    <div className="scroll">
                      <table>
                        <thead><tr><th className="num">Row</th>{dataset.columns.map(c => <th key={c} className={issue && issue.column === c ? 'hl' : ''}>{c}</th>)}</tr></thead>
                        <tbody>{previewIdx.map(i => (
                          <tr key={i}><td className="num">{i + 2}</td>{dataset.columns.map(c => {
                            const v = rows[i]?.[c] ?? '';
                            return <td key={c} className={issue && (issue.column === c || issue.column === 'All columns') ? 'hl' : ''}>{v.trim() === '' ? <i>empty</i> : v.replace(/^ +| +$/g, m => '·'.repeat(m.length))}</td>;
                          })}</tr>))}
                        </tbody>
                      </table>
                    </div>
                    <p className="foot">Row numbers match spreadsheet lines in the current working copy. Dots mark leading or trailing spaces.</p>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {mode === 'diff' && (
          <section>
            <div className="slots">
              {([['left', left, 'Original'], ['right', right, 'Updated']] as const).map(([slot, d, label]) => (
                <div key={slot} className={`slot ${d ? 'filled' : ''}`} {...drop(slot)}>
                  <span className="slot-label">{label}</span>
                  {d ? <><b>{d.name}</b><span>{d.rows.length.toLocaleString()} rows, {d.columns.length} columns</span>
                    {d.sheets && d.sheets.length > 1 && <label className="sheetpick">Sheet <select value={d.sheet} onChange={e => changeSheet(slot, e.target.value)}>{d.sheets.map(n => <option key={n}>{n}</option>)}</select></label>}</>
                    : <span>{busy ? 'Reading file…' : 'Drop a CSV or Excel file'}</span>}
                  <button className="btn small" onClick={() => pickers[slot].current?.click()}>{d ? 'Replace' : 'Choose a file'}</button>
                </div>
              ))}
            </div>
            {!(left && right) && <p className="flow">Add both versions of your dataset to begin. {GSHEETS}</p>}
            {left && right && (
              <div className="keyblock">
                <div className="keyrow">
                  <label htmlFor="key">Match rows using this column</label>
                  <select id="key" value={keyColumn} onChange={e => view(() => { setKeyColumn(e.target.value); setColFilter(''); })}>
                    <option value="">Choose a column…</option>
                    {left.columns.filter(c => right.columns.includes(c)).map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <p className="sub">Diffly pairs each row in <b>Original</b> with the row in <b>Updated</b> that has the same value in this column, such as an order ID, email or SKU. Then it compares everything else. Choose a column where every row has a different value.</p>
              </div>
            )}
            {cmp && (
              <>
                {(cmp.dupOld > 0 || cmp.dupNew > 0 || cmp.blankOld > 0 || cmp.blankNew > 0 || cmp.onlyOldCols.length > 0 || cmp.onlyNewCols.length > 0) && (
                  <div className="banner warn"><div>
                    {(cmp.dupOld > 0 || cmp.dupNew > 0) && (
                      <p><b>{(cmp.dupOld + cmp.dupNew).toLocaleString()} rows were left out because their “{keyColumn}” appears more than once</b> ({cmp.dupOld.toLocaleString()} in Original, {cmp.dupNew.toLocaleString()} in Updated). Diffly can only compare one row per ID, so it used the first row for each ID and skipped the repeats.{' '}
                        {likelyDupes ? 'Original has exactly that many more rows than Updated, so these look like duplicates that were removed. Nothing is wrong.' : 'If these are different records and not duplicates, choose a column that is unique for every row.'}</p>
                    )}
                    {(cmp.blankOld > 0 || cmp.blankNew > 0) && <p>{(cmp.blankOld + cmp.blankNew).toLocaleString()} rows have no “{keyColumn}” value, so they can’t be matched and were left out ({cmp.blankOld.toLocaleString()} in Original, {cmp.blankNew.toLocaleString()} in Updated).</p>}
                    {(cmp.onlyOldCols.length > 0 || cmp.onlyNewCols.length > 0) && <p>Some columns exist in only one file, so they can’t be compared.{cmp.onlyOldCols.length > 0 && ` Only in Original: ${cmp.onlyOldCols.join(', ')}.`}{cmp.onlyNewCols.length > 0 && ` Only in Updated: ${cmp.onlyNewCols.join(', ')}.`}</p>}
                  </div></div>
                )}

                <div className="verdict">
                  <b>{count('Changed') + count('Added') + count('Removed') === 0 ? 'The two files match.' : `${(count('Changed') + count('Added') + count('Removed')).toLocaleString()} of ${cmp.diffs.length.toLocaleString()} records differ.`}</b>
                  <span>{count('Changed').toLocaleString()} changed, {count('Added').toLocaleString()} added, {count('Removed').toLocaleString()} removed, {count('Unchanged').toLocaleString()} unchanged.</span>
                </div>
                <details className="help">
                  <summary>How to read these results</summary>
                  <ul>
                    <li><b>Original</b> is the older file and <b>Updated</b> is the newer one.</li>
                    <li><b>Changed</b>: the record is in both files but at least one value is different.</li>
                    <li><b>Added</b>: only in Updated. <b>Removed</b>: only in Original. <b>Unchanged</b>: nothing differs.</li>
                    <li><del>Crossed-out red</del> is the old value and <ins>green</ins> is the new value. “empty” means the cell was blank.</li>
                  </ul>
                </details>

                {colSummary.length > 0 && (
                  <div className="colsum">
                    <h2>Where the changes are</h2>
                    <p className="sub">Select a column to list only the records where it changed.</p>
                    <table>
                      <thead><tr><th>Column</th><th>Records changed</th><th>What changed</th></tr></thead>
                      <tbody>
                        {(showAllCols ? colSummary : colSummary.slice(0, 6)).map(sm => (
                          <tr key={sm.col} className={colFilter === sm.col ? 'sel' : ''}>
                            <td><button className="colbtn" aria-pressed={colFilter === sm.col} onClick={() => view(() => setColFilter(colFilter === sm.col ? '' : sm.col))}>{sm.col}</button></td>
                            <td><span className="meter"><span style={{ width: `${Math.max(4, (sm.rows / colSummary[0].rows) * 100)}%` }} /></span>{sm.rows.toLocaleString()}</td>
                            <td className="typ">{sm.distinct === 1
                              ? <>Every one changed from <del>{sm.from}</del> <ArrowRight size={12} /> <ins>{sm.to}</ins></>
                              : sm.n / sm.rows >= 0.5
                                ? <>Mostly <del>{sm.from}</del> <ArrowRight size={12} /> <ins>{sm.to}</ins> <span className="dim">({sm.n.toLocaleString()} of {sm.rows.toLocaleString()})</span></>
                                : <><span className="dim">A different change in each record, for example</span> <del>{sm.from}</del> <ArrowRight size={12} /> <ins>{sm.to}</ins></>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {colSummary.length > 6 && <button className="link" onClick={() => setShowAllCols(!showAllCols)}>{showAllCols ? 'Show fewer columns' : `Show all ${colSummary.length} columns`}</button>}
                  </div>
                )}

                <div className="results-head">
                  <div className="chips" role="tablist">
                    {STATUSES.map(st => <button key={st} role="tab" title={HELP[st]} aria-selected={filter === st} className={`chip ${filter === st ? 'on' : ''}`} onClick={() => view(() => setFilter(st))}>{st} <b>{(st === 'All' ? cmp.diffs.length : count(st)).toLocaleString()}</b></button>)}
                  </div>
                  <div className="row-actions">
                    <input className="search" type="search" placeholder={`Search ${keyColumn}`} aria-label={`Search ${keyColumn}`} value={query} onChange={e => view(() => setQuery(e.target.value))} />
                    <button className="btn primary" onClick={() => downloadCsv('comparison.csv', comparisonRows(cmp, keyColumn, shown))} disabled={!shown.length}><Download size={15} /> Export {shown.length.toLocaleString()}</button>
                  </div>
                </div>
                {colFilter && <p className="activefilter">Showing records where <b>{colFilter}</b> changed. <button className="link" onClick={() => view(() => setColFilter(''))}>Clear</button></p>}

                <div className="scroll results">
                  <table>
                    <thead><tr><th>{keyColumn}</th><th>Status</th><th>What changed</th></tr></thead>
                    <tbody>
                      {pageRows.map(d => {
                        const open = expanded.has(d.key);
                        const ordered = colFilter ? [colFilter, ...d.changedColumns.filter(c => c !== colFilter)] : d.changedColumns;
                        const list = open ? ordered : ordered.slice(0, 3);
                        return (
                          <tr key={d.key}>
                            <td className="mono">{d.key}</td>
                            <td><span className={`status s-${d.status.toLowerCase()}`}>{d.status}</span></td>
                            <td>
                              {d.status === 'Changed' && <>{list.map(c => <span className="chg" key={c}><em>{c}</em><del>{d.before?.[c]?.trim() || 'empty'}</del><ArrowRight size={12} /><ins>{d.after?.[c]?.trim() || 'empty'}</ins></span>)}
                                {ordered.length > 3 && <button className="link more" onClick={() => toggle(d.key)}>{open ? 'Show less' : `+${ordered.length - 3} more`}</button>}</>}
                              {d.status === 'Added' && <span className="dim">{peek(d.after)}</span>}
                              {d.status === 'Removed' && <span className="dim">{peek(d.before)}</span>}
                              {d.status === 'Unchanged' && <span className="dim">Identical</span>}
                            </td>
                          </tr>
                        );
                      })}
                      {shown.length === 0 && <tr><td colSpan={3} className="dim">No records match these filters.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {shown.length > PAGE && (
                  <div className="pager">
                    <button className="btn small" disabled={pg === 0} onClick={() => setPage(pg - 1)}>Previous</button>
                    <span>{(pg * PAGE + 1).toLocaleString()} to {Math.min(shown.length, pg * PAGE + PAGE).toLocaleString()} of {shown.length.toLocaleString()}</span>
                    <button className="btn small" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next</button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
        {mode === 'explore' && (
          <section>
            {!dataset || !current ? (
              <div className="drop" {...drop('single')}>
                <h2>{busy ? 'Reading file…' : 'Open a file to explore'}</h2>
                <p>Get every column’s type, spread, empty cells and relationships on one page. It all happens in this tab.</p>
                <div className="row-actions"><button className="btn primary" onClick={() => openPicker('explore')}>Choose a file</button></div>
                <p className="hint">{GSHEETS}</p>
              </div>
            ) : (
              <Explore data={current} cleaned={!!working} onReplace={() => openPicker('explore')} onClean={() => setMode('check')} onSheet={s => changeSheet('single', s)} />
            )}
          </section>
        )}
        <input ref={pickers.single} hidden type="file" accept={ACCEPT} onChange={e => { load(e.target.files?.[0], 'single', nextRef.current); e.target.value = ''; }} />
        <input ref={pickers.left} hidden type="file" accept={ACCEPT} onChange={e => { load(e.target.files?.[0], 'left'); e.target.value = ''; }} />
        <input ref={pickers.right} hidden type="file" accept={ACCEPT} onChange={e => { load(e.target.files?.[0], 'right'); e.target.value = ''; }} />
      </main>
      <footer>Free and open source (MIT). CSV only for now; heuristic checks can be wrong, so review before you trust them.</footer>
    </div>
  );
}
