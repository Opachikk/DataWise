# DataWise

**Make your data useful.** A free, open-source toolkit for the everyday work of understanding spreadsheets. It runs entirely in your browser: no account, no upload, no server.

<!-- Add a screenshot here once you have one, e.g. ![DataWise](docs/screenshot.png) -->

DataWise has two independent tools in one workspace.

## SheetCheck: inspect and clean one file

Open a CSV or Excel file and SheetCheck points out the things that quietly break an analysis:

- Duplicate rows
- Missing values
- Extra spaces (leading, trailing, doubled)
- Inconsistent capitalization (`Sales` vs `sales`)
- Repeated values in ID-like columns
- Potential numeric outliers

Select a finding to see the affected rows highlighted in a preview. Then either fix findings one at a time, or press **Clean my data** to fix everything at once. By default, one click removes duplicates, trims spaces, matches capitalization and fills blanks, and leaves outliers alone for you to review. You choose how each kind of problem is handled:

| Problem | Options |
| --- | --- |
| Duplicate rows, extra spaces, capitalization | On or off |
| Missing values | Fill in (median for numbers, "Unknown" for text), remove the rows, or leave alone |
| Outliers | Leave alone (default), pull extreme values back to the nearest normal value, or remove the rows |

Cleaning works on a copy. Your original file is never modified, you get a report of exactly what changed, and **Undo all changes** restores the original. Export the result as CSV.

## Diffly: compare two files

Load two versions of a dataset, choose the column that identifies each record (an order ID, email, SKU), and Diffly shows which records were **added**, **removed**, **changed**, or **unchanged**.

- A "Where the changes are" summary shows which columns changed most, so you don't have to read every row.
- Filter by status or column, search by ID, and page through the results.
- Warns you when the matching column has repeated or blank values, or when a column exists in only one file.
- Export the comparison, with old and new values side by side, as CSV.

You can also send a cleaned file straight from SheetCheck to Diffly to see exactly what the cleaning changed.

## Supported files

- CSV (`.csv`, `.tsv`, `.txt`)
- Excel (`.xlsx`). If a workbook has several sheets, pick the sheet you want.
- Google Sheets: in Sheets, choose **File → Download → Microsoft Excel (.xlsx)** or **CSV**, then open the downloaded file in DataWise.

Not supported yet: old `.xls` files (save as `.xlsx` or CSV), password-protected workbooks, and direct Google Sheets links.

## Privacy

Files are read and processed in your browser tab. DataWise has no backend and does not send your data anywhere. Nothing is saved between visits, so closing or refreshing the tab clears your data.

## Run locally

You need [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install
npm run dev
```

Build a static site into `dist/`:

```bash
npm run build
npm run preview   # optional: serve the built site locally
```

DataWise is a static site, so `dist/` can be hosted anywhere (Vercel, Netlify, GitHub Pages, or any static file host).

## Tech

React, TypeScript and Vite. CSV parsing by [PapaParse](https://www.papaparse.com/), Excel reading by [read-excel-file](https://www.npmjs.com/package/read-excel-file), icons by [Lucide](https://lucide.dev/).

## Limitations

DataWise is an early release.

- The checks are heuristics and can be wrong. A repeated value or an outlier is not necessarily an error, so review findings before relying on them.
- Filling missing values (and capping outliers, if you turn that on) makes educated guesses. Treat those values as estimates and keep your original file.
- Outlier detection is simple. In skewed columns such as prices it can flag many normal values, which is why outliers are left alone by default.
- Diffly compares one row per ID. If the matching column has repeats, only the first row for each ID is used, and the tool tells you how many rows were skipped.
- Very large files are held in browser memory. 50,000 rows works well in testing, but results depend on your device.
- Exports are CSV only.
- Comparison is exact after trimming spaces. There is no fuzzy matching.

## Contributing

Ideas and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Please use synthetic data in issues and screenshots, never real personal data.

## License

MIT. See [LICENSE](./LICENSE).
