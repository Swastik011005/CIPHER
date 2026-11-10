#!/usr/bin/env python
"""Build docs/CIPHER_FINAL_TECHNICAL_REPORT.pdf from docs/CIPHER_FINAL_TECHNICAL_REPORT.md.

    python scripts/build_report_pdf.py

The Markdown is converted to HTML (the `markdown` package, `pip install markdown`) and printed to PDF by a headless Chrome or Edge
(set NETSEC_BROWSER_PATH if the browser is somewhere unusual). Nothing is sent anywhere. Rebuild the PDF whenever the Markdown report
changes, so the two never disagree.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "CIPHER_FINAL_TECHNICAL_REPORT.md"
TARGET = ROOT / "docs" / "CIPHER_FINAL_TECHNICAL_REPORT.pdf"

CSS = """
@page { size: A4; margin: 16mm 14mm; }
body { font: 10.5pt/1.45 'Segoe UI', Calibri, Arial, sans-serif; color: #1a2233; }
h1 { font-size: 20pt; margin: 0 0 6pt; } h2 { font-size: 14pt; margin: 18pt 0 4pt; border-bottom: 1px solid #c9d3e6; padding-bottom: 2pt; }
h3 { font-size: 11.5pt; margin: 12pt 0 3pt; }
code { font: 9pt Consolas, 'Courier New', monospace; background: #eef2f9; padding: 0 2pt; border-radius: 2pt; }
pre { background: #eef2f9; padding: 6pt 8pt; border-radius: 4pt; overflow-wrap: anywhere; white-space: pre-wrap; } pre code { background: none; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9.5pt; } th, td { border: 1px solid #c9d3e6; padding: 3pt 5pt; vertical-align: top; }
th { background: #e4ebf7; text-align: left; } blockquote { margin: 8pt 0; padding: 4pt 10pt; border-left: 3px solid #4da3ff; background: #f2f7ff; }
tr, pre, blockquote { page-break-inside: avoid; } h1, h2, h3 { page-break-after: avoid; }
"""


def find_browser() -> str:
    candidates = [
        os.environ.get("NETSEC_BROWSER_PATH", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    raise SystemExit("no Chrome or Edge found (set NETSEC_BROWSER_PATH to its executable)")


def main() -> int:
    try:
        import markdown
    except ImportError:
        raise SystemExit("this script needs the `markdown` package: python -m pip install markdown")
    text = SOURCE.read_text(encoding="utf-8")
    body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])
    html = f"<!doctype html><html><head><meta charset='utf-8'><title>CIPHER Final Technical Report</title><style>{CSS}</style></head><body>{body}</body></html>"
    with tempfile.TemporaryDirectory(prefix="cipher-report-") as tmp:
        page = Path(tmp) / "report.html"
        page.write_text(html, encoding="utf-8")
        profile = Path(tmp) / "profile"
        cmd = [find_browser(), "--headless=new", "--disable-gpu", f"--user-data-dir={profile}", "--no-pdf-header-footer", f"--print-to-pdf={TARGET}", page.as_uri()]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    print(f"wrote {TARGET.relative_to(ROOT)} ({TARGET.stat().st_size // 1024} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
