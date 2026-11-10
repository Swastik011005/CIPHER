# Naming: CIPHER and the identifiers that keep their original names

The project's official name is **CIPHER** (it was called NetSec 3D while it was being built). Everything a user sees uses CIPHER: the
website, the page titles, the README, the user manual, the report, the presentation and the tools' output.

A few technical identifiers still carry the original `netsec` name. They are internal, nothing a visitor reads, and renaming them
would break imports, deployments or the automated checks without changing anything visible. They are kept on purpose:

| Identifier | Where it is used | Why it stays |
|---|---|---|
| Python package `netsec` (`backend/netsec/`) | Every backend import, the tests, `app.py` | Renaming it touches every module and test for no visible gain |
| `NETSEC_*` environment variables (`NETSEC_ENV`, `NETSEC_PORT`, `NETSEC_HOST`, `NETSEC_CORS_ORIGINS`, `NETSEC_RULES_READ_ONLY`, `NETSEC_BROWSER_PATH` and the rest listed in `backend/.env.example`) | Server configuration, `render.yaml`, CI, the check scripts | A rename would silently break existing deployments and `.env` files |
| `window.__netsec*` handles (`__netsecStore`, `__netsecProbe`, `__netsecScene`, ...) | Debug aids, present only when a page is opened with `?debug=1` | The real-browser check scripts read them |
| The repository folder name on the original developer's machine | Local paths only | A local folder name is not part of the project; rename it freely |
| `docs/STAGE*_PROGRESS.md`, `docs/STAGE1_ISSUES.md`, `docs/design/` | Historical stage records and design proposals | They record what was true when they were written, including the old name |

Names that **were** changed to CIPHER, so that nothing visible keeps the old brand: the website and page titles, the engine's
health name (`cipher-engine`), the front-end package (`cipher-frontend`), the Render service names (`cipher`, `cipher-api`), the
final report and its PDF, the presentation, the user manual, the temporary-folder prefixes the check scripts use, and the README.

## Rebuilding generated deliverables

- `python scripts/build_report_pdf.py` rebuilds `docs/CIPHER_FINAL_TECHNICAL_REPORT.pdf` from the Markdown report (needs the
  `markdown` package and Chrome or Edge). Rebuild it whenever the report changes.
- `node docs/presentation/build_deck.js` rebuilds the presentation (see the header of that file; it needs `pptxgenjs`).
