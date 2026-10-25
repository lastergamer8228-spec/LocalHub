"""Every local asset referenced by a shipped page must actually be servable.

WHY THIS EXISTS
    On 2026-10-24 a redesign shipped theme-pro.css and nav.js inside the APK and
    linked them from every page, but AssetServer.kt routes assets through an
    explicit whitelist, so both 404'd. The pages rendered unstyled and with no
    navigation. The build, the unit tests and the web-shell test all passed,
    because none of them asked the only question that mattered: does the server
    actually serve this URL?

WHAT IT DOES
    1. Mirrors AssetServer.resolve() (exact map parsed from the Kotlin source +
       the prefix rules + the generic root-asset fallback).
    2. Walks every HTML file under app/src/main/assets and collects local
       src/href URLs.
    3. Asserts each one resolves to a file that exists in the assets tree.

NOT device verification - it is a source-level route check.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app/src/main/assets"
SERVER = ROOT / "app/src/main/java/com/localhub/localhub/server/AssetServer.kt"

kotlin = SERVER.read_text()

# 1. exact mappings:  uri == "/style.css" -> "dashboard/style.css"
exact = {}
for block in re.findall(r'uri == "([^"]+)"(?:\s*\|\|\s*uri == "([^"]+)")*\s*->\s*"([^"]+)"', kotlin):
    pass  # handled below with a simpler pattern

exact = {}
for m in re.finditer(r'uri == "([^"]+)" -> "([^"]+)"', kotlin):
    exact[m.group(1)] = m.group(2)

ROOT_ASSET = re.compile(r"^/[A-Za-z0-9._-]+\.(css|js|mjs|json|png|jpe?g|gif|svg|ico|webmanifest|txt|map|woff2?)$")


def resolve(uri: str):
    """Mirror of AssetServer.resolve()."""
    if uri in exact:
        return exact[uri]
    if uri in ("/", ""):
        return "dashboard/index.html"
    if uri.startswith("/os/") or uri in ("/os",):
        return "os/" + uri.removeprefix("/os/")
    if uri.startswith("/dashboard/"):
        return "dashboard/" + uri.removeprefix("/dashboard/")
    if uri.startswith("/assets/"):
        return uri.removeprefix("/")
    if uri in ("/ai",) or uri.startswith("/ai/"):
        return "ai/index.html" if uri in ("/ai", "/ai/index.html") else "ai/" + uri.removeprefix("/ai/")
    if ROOT_ASSET.match(uri):
        return "dashboard/" + uri.removeprefix("/")
    return None


# 2. collect local references from every shipped HTML page
SKIP_SCHEMES = ("http://", "https://", "//", "mailto:", "tel:", "data:", "#", "javascript:")
refs = {}
for html in sorted(ASSETS.rglob("*.html")):
    text = html.read_text(encoding="utf-8", errors="replace")
    urls = re.findall(r'(?:src|href)\s*=\s*"([^"]+)"', text)
    for u in urls:
        if not u.startswith("/"):
            continue
        if u.startswith(SKIP_SCHEMES):
            continue
        # page routes carry query strings (/player?file=...); only the path matters
        u = u.split("?", 1)[0].split("#", 1)[0]
        if not u or u == "/":
            continue
        if u.startswith("/api/") or u in ("/ws",):
            continue  # server endpoints, not bundled files
        refs.setdefault(u, []).append(html.relative_to(ASSETS).as_posix())

# 3. verify
problems = []
for url, pages in sorted(refs.items()):
    target = resolve(url)
    if target is None:
        problems.append(f"{url}  ->  NO ROUTE (referenced by {', '.join(sorted(set(pages)))})")
        continue
    if not (ASSETS / target).exists():
        problems.append(f"{url}  ->  {target}  MISSING FILE (referenced by {', '.join(sorted(set(pages)))})")

print(f"checked {len(refs)} distinct local asset URLs across "
      f"{len(list(ASSETS.rglob('*.html')))} pages")
for p in problems:
    print("FAIL", p)
if problems:
    raise SystemExit(f"{len(problems)} asset route problem(s) found")

print(f"PASS all {len(refs)} referenced assets resolve to files that exist")

# --- structural guards -------------------------------------------------------
# A nav mount point placed between </head> and <body> is relocated by the
# browser and breaks the page's own DOM lookups. It broke /ai (assistant dead)
# and the file manager before it was caught.
for page in [
    "app/src/main/assets/dashboard/index.html",
    "app/src/main/assets/dashboard/files.html",
]:
    html = (ROOT / page).read_text(encoding="utf-8", errors="replace")
    if 'id="lh-nav"' in html:
        assert html.index("<body") < html.index('id="lh-nav"'), (
            page + ": nav mount point is outside <body>"
        )
print("PASS nav mount points sit inside <body>")

# Entry-point URLs must resolve. "/ai/" used to fall through to the startsWith
# rule and became the directory "ai/", so every Assistant link 404'd.
ENTRY_URLS = ["/", "/index.html", "/files", "/player", "/ai", "/ai/", "/ai/index.html"]
for url in ENTRY_URLS:
    target = resolve(url)
    assert target, "entry URL has no route: " + url
    assert (ASSETS / target).exists(), "entry URL %s -> missing %s" % (url, target)
print("PASS %d entry-point URLs resolve" % len(ENTRY_URLS))
