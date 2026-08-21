#!/usr/bin/env python3
"""Baut die Datenschutz-Seite fuer GitHub Pages.

Bewusst werden NUR die beiden Datenschutz-Dateien veroeffentlicht — alles
andere in docs/ bleibt aussen vor.

Aufruf:  python3 scripts/build_privacy_site.py [ziel-ordner]
"""
import pathlib
import re
import sys

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "site")

# (Quelldatei, Zieldatei, <title>, Link-Text zur anderen Sprache)
PAGES = [
    ("docs/PRIVACY.md",    "index.html", "Datenschutzerklärung — myEcho", "English version", "privacy-en.html"),
    ("docs/PRIVACY_EN.md", "privacy-en.html", "Privacy Policy — myEcho",  "Deutsche Fassung", "index.html"),
]

TEMPLATE = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<title>{title}</title>
<style>
  :root {{ --bg:#ffffff; --fg:#1f2328; --muted:#57606a; --line:#d0d7de; --accent:#0969da; --code:#f6f8fa; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --line:#30363d; --accent:#4493f8; --code:#161b22; }}
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }}
  main {{ max-width: 46rem; margin:0 auto; padding: 2.5rem 1.25rem 4rem; }}
  h1 {{ font-size:1.75rem; line-height:1.25; margin:0 0 .5rem; }}
  h2 {{ font-size:1.2rem; margin:2.25rem 0 .75rem; padding-bottom:.3rem; border-bottom:1px solid var(--line); }}
  a {{ color:var(--accent); }}
  hr {{ display:none; }}
  blockquote {{ margin:1.25rem 0; padding:.75rem 1rem; border-left:3px solid var(--line);
    background:var(--code); color:var(--muted); border-radius:0 6px 6px 0; }}
  blockquote p {{ margin:.35rem 0; }}
  code {{ background:var(--code); padding:.15em .35em; border-radius:4px; font-size:.9em; }}
  ul {{ padding-left:1.4rem; }}
  li {{ margin:.35rem 0; }}
  .switch {{ display:inline-block; margin-bottom:2rem; font-size:.9rem; }}
  footer {{ margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line);
    color:var(--muted); font-size:.85rem; }}
</style>
</head>
<body>
<main>
<a class="switch" href="{other_href}">{other_label} →</a>
{body}
<footer>myEcho — assistive Kommunikations-App · <a href="https://github.com/seiferla/My-Echo">Quellcode</a></footer>
</main>
</body>
</html>
"""


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for src, dst, title, other_label, other_href in PAGES:
        text = (ROOT / src).read_text(encoding="utf-8")

        # HTML-Kommentare entfernen: interne Notizen duerfen nicht im
        # Seitenquelltext landen (waeren ueber "Quelltext anzeigen" lesbar).
        text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)

        body = markdown.markdown(text, extensions=["tables", "sane_lists"])
        html = TEMPLATE.format(
            lang="en" if src.endswith("_EN.md") else "de",
            title=title,
            body=body,
            other_label=other_label,
            other_href=other_href,
        )
        (OUT / dst).write_text(html, encoding="utf-8")
        print(f"  {src}  ->  {OUT.name}/{dst}")

    # .nojekyll: GitHub soll die Dateien unveraendert ausliefern
    (OUT / ".nojekyll").write_text("", encoding="utf-8")
    print(f"fertig: {OUT}")


if __name__ == "__main__":
    build()
