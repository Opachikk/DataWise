import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, ScanSearch } from 'lucide-react';
import { downloadCsv, type Dataset } from './data';
import { fmtNum, fmtPct, profileDataset, strength, summaryRows, SUMMARY_COLUMNS, type ColProfile, type ColType, type Profile } from './eda';

type Group = 'all' | 'number' | 'category' | 'date' | 'other';
const GROUPS: [Group, string][] = [['all', 'All'], ['number', 'Numbers'], ['category', 'Categories'], ['date', 'Dates'], ['other', 'Text and IDs']];
const groupOf = (t: ColType): Group => (t === 'number' ? 'number' : t === 'category' || t === 'boolean' ? 'category' : t === 'date' ? 'date' : 'other');
const LABEL: Record<ColType, string> = { number: 'Number', date: 'Date', boolean: 'Yes / No', category: 'Category', text: 'Text', id: 'ID', empty: 'Empty' };

function Bars({ values, labels, caption }: { values: number[]; labels: string[]; caption: string }) {
  const max = Math.max(...values, 1), w = 100 / values.length;
  return (
    <svg className="bars" viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label={caption}>
      {values.map((v, i) => { const h = (v / max) * 46; return <rect key={i} x={i * w + 0.5} width={Math.max(0.5, w - 1)} y={48 - h} height={h}><title>{`${labels[i]}: ${v.toLocaleString()}`}</title></rect>; })}
    </svg>
  );
}

function Card({ c }: { c: ColProfile }) {
  const s = c.num;
  return (
    <article className="colcard">
      <header><h3 title={c.name}>{c.name}</h3><span className={`tag t-${c.type}`}>{LABEL[c.type]}</span></header>
      <p className="cmeta">{c.missing > 0 ? `${fmtPct(c.missingPct)} empty · ` : ''}{c.distinct.toLocaleString()} distinct value{c.distinct === 1 ? '' : 's'}</p>
      {c.type === 'number' && s && (
        <>
          <Bars values={s.bins} labels={s.bins.map((_, i) => `${fmtNum(s.lo + ((s.hi - s.lo) / 12) * i)} to ${fmtNum(s.lo + ((s.hi - s.lo) / 12) * (i + 1))}`)} caption={`Distribution of ${c.name}`} />
          <div className="axis"><span>{fmtNum(s.lo)}</span><span>{fmtNum(s.hi)}</span></div>
          {s.clipped && <p className="cnote">Chart zooms in on the middle 98% of values. The tails are folded into the end bars.</p>}
          <dl className="kv">
            <div><dt>Lowest</dt><dd>{fmtNum(s.min)}</dd></div><div><dt>Median</dt><dd>{fmtNum(s.median)}</dd></div>
            <div><dt>Average</dt><dd>{fmtNum(s.mean)}</dd></div><div><dt>Highest</dt><dd>{fmtNum(s.max)}</dd></div>
            <div><dt>Middle 50%</dt><dd>{fmtNum(s.q1)} to {fmtNum(s.q3)}</dd></div><div><dt>Std. deviation</dt><dd>{fmtNum(s.std)}</dd></div>
          </dl>
          {s.outliers > 0 && <p className="cnote">{s.outliers.toLocaleString()} value{s.outliers === 1 ? ' is' : 's are'} far from the rest.</p>}
          {c.bad > 0 && <p className="cnote">{c.bad.toLocaleString()} entr{c.bad === 1 ? 'y is' : 'ies are'} not a number and {c.bad === 1 ? 'was' : 'were'} ignored.</p>}
        </>
      )}
      {c.type === 'date' && c.dates && (
        <>
          <Bars values={c.dates.buckets.map(b => b.count)} labels={c.dates.buckets.map(b => b.label)} caption={`Records per ${c.dates.unit} in ${c.name}`} />
          <div className="axis"><span>{c.dates.buckets[0].label}</span><span>{c.dates.buckets[c.dates.buckets.length - 1].label}</span></div>
          <p className="cnote">Counts per {c.dates.unit}. Earliest {c.dates.min}, latest {c.dates.max}.</p>
        </>
      )}
      {(c.type === 'category' || c.type === 'boolean' || c.type === 'text') && c.top && (
        <>
          <ul className="toplist">
            {c.top.map(t => (
              <li key={t.value}><span className="tl" title={t.value}>{t.value}</span><span className="tb"><span style={{ width: `${(t.count / c.top![0].count) * 100}%` }} /></span><span className="tn">{t.count.toLocaleString()} <small>{fmtPct((t.count / c.count) * 100)}</small></span></li>
            ))}
          </ul>
          {c.distinct > c.top.length && <p className="cnote">Showing the {c.top.length} most common of {c.distinct.toLocaleString()}.</p>}
          {c.type === 'text' && c.avgLen !== undefined && <p className="cnote">Average length {Math.round(c.avgLen)} characters.</p>}
        </>
      )}
      {c.type === 'id' && <p className="cnote">Looks like an identifier, so each value should be unique.{c.distinct < c.count ? ` ${(c.count - c.distinct).toLocaleString()} repeat.` : ' All are unique.'}</p>}
      {c.type === 'empty' && <p className="cnote">This column has no values.</p>}
    </article>
  );
}

function tone(r: number | null) {
  if (r === null) return {};
  const a = Math.min(1, Math.abs(r)) * 0.85;
  return { background: r >= 0 ? `rgba(28,106,52,${a})` : `rgba(163,46,34,${a})`, color: a > 0.55 ? '#fff' : undefined };
}

export default function Explore({ data, cleaned, onReplace, onClean, onSheet }: { data: Dataset; cleaned: boolean; onReplace: () => void; onClean: () => void; onSheet: (s: string) => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [grp, setGrp] = useState<Group>('all');
  const [allInsights, setAllInsights] = useState(false);
  useEffect(() => { setP(null); const t = setTimeout(() => setP(profileDataset(data)), 30); return () => clearTimeout(t); }, [data]);
  const cols = useMemo(() => (p ? p.columns.filter(c => grp === 'all' || groupOf(c.type) === grp) : []), [p, grp]);
  const TYPES: [ColType, string, string][] = [['number', 'number', 'numbers'], ['category', 'category', 'categories'], ['boolean', 'yes/no', 'yes/no'], ['date', 'date', 'dates'], ['text', 'text', 'text'], ['id', 'ID', 'IDs'], ['empty', 'empty', 'empty']];

  return (
    <>
      <div className="filebar">
        <FileSpreadsheet size={18} />
        <div className="fname"><b>{data.name}</b><span>{data.rows.length.toLocaleString()} rows, {data.columns.length} columns{data.sheet && data.sheets && data.sheets.length > 1 ? `, sheet “${data.sheet}”` : ''}{cleaned ? ' (your cleaned copy)' : ''}</span></div>
        <div className="row-actions">
          {data.sheets && data.sheets.length > 1 && <label className="sheetpick">Sheet <select value={data.sheet} onChange={e => onSheet(e.target.value)}>{data.sheets.map(n => <option key={n}>{n}</option>)}</select></label>}
          <button className="btn" onClick={onReplace}>Replace</button>
          <button className="btn" onClick={onClean}><ScanSearch size={15} /> Clean in SheetCheck</button>
          <button className="btn primary" disabled={!p} onClick={() => p && downloadCsv(`summary-${data.name.replace(/\.[^.]+$/, '')}.csv`, summaryRows(p), SUMMARY_COLUMNS)}><Download size={15} /> Download summary</button>
        </div>
      </div>

      {!p ? <p className="loading">Reading your data…</p> : (
        <>
          <div className="stats">
            <div><b>{p.rows.toLocaleString()}</b><span>rows</span></div>
            <div><b>{p.cols.toLocaleString()}</b><span>columns</span></div>
            <div><b>{fmtPct(p.missingPct)}</b><span>of cells are empty</span></div>
            <div><b>{p.dupRows.toLocaleString()}</b><span>duplicate rows</span></div>
            <div className="wide"><b>{TYPES.filter(([t]) => p.typeCounts[t]).map(([t, one, many]) => `${p.typeCounts[t]} ${p.typeCounts[t] === 1 ? one : many}`).join(', ')}</b><span>column types, detected from the values</span></div>
          </div>

          <section className="block">
            <h2>Worth noticing</h2>
            <p className="sub">Found automatically. Treat these as leads to check, not conclusions.</p>
            <ul className="insights">
              {(allInsights ? p.insights : p.insights.slice(0, 7)).map((i, k) => <li key={k} className={i.level}><span className="dot" aria-hidden />{i.text}</li>)}
            </ul>
            {p.insights.length > 7 && <button className="link" onClick={() => setAllInsights(!allInsights)}>{allInsights ? 'Show fewer' : `Show all ${p.insights.length}`}</button>}
          </section>

          <section className="block">
            <div className="block-head">
              <h2>Every column</h2>
              <div className="chips">{GROUPS.map(([g, l]) => <button key={g} className={`chip ${grp === g ? 'on' : ''}`} onClick={() => setGrp(g)}>{l} <b>{g === 'all' ? p.columns.length : p.columns.filter(c => groupOf(c.type) === g).length}</b></button>)}</div>
            </div>
            <div className="cards">{cols.map(c => <Card key={c.name} c={c} />)}</div>
            {cols.length === 0 && <p className="dim">No columns of this kind.</p>}
          </section>

          {p.corr.cols.length >= 2 && (
            <section className="block">
              <h2>How numeric columns relate</h2>
              <p className="sub">Green means two columns tend to rise together, red means one rises as the other falls. Relationships show a pattern, not a cause.{p.corr.truncated ? ' Only the first 12 numeric columns are shown.' : ''}</p>
              <div className="corr-wrap">
                <div className="scroll">
                  <table className="heat">
                    <thead><tr><th />{p.corr.cols.map(c => <th key={c} title={c}>{c}</th>)}</tr></thead>
                    <tbody>{p.corr.cols.map((rc, i) => <tr key={rc}><th title={rc}>{rc}</th>{p.corr.cols.map((cc, j) => <td key={cc} style={tone(p.corr.matrix[i][j])} title={`${rc} and ${cc}`}>{p.corr.matrix[i][j] === null ? '' : i === j ? '' : p.corr.matrix[i][j]!.toFixed(2)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                <ul className="pairs">
                  {p.corr.pairs.slice(0, 5).map(pr => <li key={pr.a + pr.b}><b>{pr.a}</b> and <b>{pr.b}</b><span>{strength(pr.r)} {pr.r > 0 ? 'positive' : 'negative'} (r = {pr.r.toFixed(2)})</span></li>)}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
