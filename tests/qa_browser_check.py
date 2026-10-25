#!/usr/bin/env python3
"""Load every LocalHub web page in a real headless browser and MEASURE it.

This exists because two rounds of UI work were shipped without ever loading the
page. It answers the questions that were guessed at before:

  - does the page throw in the console, or fail to load a resource?
  - does it scroll sideways on a phone (360px)? that is the "mobile me webpage
    bhar bhar ke issue" complaint
  - are there elements sticking out of the viewport?
  - are tap targets big enough to hit?
  - is any text unreadably small?

It also writes screenshots to tests/qa-shots/ so a human can look at them.

Usage:  python3 tests/qa_browser_check.py
Requires: pip install playwright && python3 -m playwright install chromium
"""
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
SHOTS = TESTS / "qa-shots"
SERVER = TESTS / "qa_stub_server.py"
PORT = 8099
BASE = f"http://127.0.0.1:{PORT}"

PAGES = [
    ("/", "dashboard"),
    ("/player", "player"),
    ("/player?file=demo.mp4", "player-file"),
    ("/files", "files"),
]
WIDTHS = [(360, 740, "phone"), (768, 900, "tablet"), (1440, 900, "desktop")]

PROBE = """
() => {
  const doc = document.documentElement;
  const vw = window.innerWidth;
  const out = {
    scrollW: doc.scrollWidth,
    clientW: doc.clientWidth,
    horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
    overflowPx: Math.max(0, doc.scrollWidth - doc.clientWidth),
    stuck: [],
    tinyText: [],
    smallTaps: [],
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60),
    visibleText: (document.body.innerText || '').trim().length
  };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 2 || r.left < -2) {
      const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '');
      if (!seen.has(tag) && out.stuck.length < 12) { seen.add(tag); out.stuck.push(tag + ' @' + Math.round(r.left) + '..' + Math.round(r.right)); }
    }
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize || '16');
    if (el.closest('svg')) continue; // svg text scales with its viewBox
    if (el.childElementCount === 0 && (el.textContent || '').trim() && fs < 10 && out.tinyText.length < 8) {
      out.tinyText.push(el.tagName.toLowerCase() + ' ' + fs.toFixed(1) + 'px');
    }
  }
  for (const el of document.querySelectorAll('button, a, input, select, [role=button]')) {
    if (el.tagName === 'INPUT' && el.type === 'range') continue; // target is the thumb
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 28 || r.width < 28) {
      const name = (el.textContent || el.id || el.className || el.tagName).toString().trim().slice(0, 28);
      if (out.smallTaps.length < 10) out.smallTaps.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  // Is the control really hittable, or is something drawn on top of it?
  out.covered = [];
  for (const el of document.querySelectorAll('button, a[class*=btn], .ctrl, .control, [data-cmd], .chip')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // below the fold is normal (you scroll); off to the side is not
    if (cy > window.innerHeight) continue;
    if (cx < 0 || cy < 0 || cx > vw) {
      const name = (el.textContent || el.id || el.className || el.tagName).toString().trim().slice(0, 26);
      if (out.covered.length < 10) out.covered.push('OFFSCREEN ' + name + ' @' + Math.round(cx) + ',' + Math.round(cy));
      continue;
    }
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !(el.contains(hit) || hit.contains(el))) {
      const name = (el.textContent || el.id || el.className || el.tagName).toString().trim().slice(0, 26);
      const over = (hit.tagName + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.trim().split(/\\s+/)[0] : '')).slice(0, 26);
      if (out.covered.length < 10) out.covered.push('COVERED ' + name + ' by ' + over);
    }
  }
  return out;
}
"""


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright missing: pip install playwright && python3 -m playwright install chromium")
        return 2

    server = subprocess.Popen([sys.executable, str(SERVER)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    problems = []
    try:
        SHOTS.mkdir(exist_ok=True)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for path, name in PAGES:
                for width, height, label in WIDTHS:
                    page = browser.new_page(viewport={"width": width, "height": height})
                    errors, console_errors, failed = [], [], []
                    page.on("pageerror", lambda e: errors.append(str(e)[:200]))
                    page.on("console", lambda m: console_errors.append(m.text[:160]) if m.type == "error" else None)
                    page.on("requestfailed", lambda r: failed.append(r.url.split("/")[-1][:60]))
                    try:
                        sep = "&" if "?" in path else "?"
                        page.goto(BASE + path + sep + "token=stub", wait_until="load", timeout=20000)
                        page.wait_for_timeout(1800)
                        probe = page.evaluate(PROBE)
                    except Exception as exc:  # noqa: BLE001
                        problems.append(f"{name}/{label}: page failed to load -> {exc}")
                        page.close()
                        continue

                    shot = SHOTS / f"{name}-{label}-{width}.png"
                    page.screenshot(path=str(shot), full_page=(label == "phone"))
                    page.close()

                    print(f"\n== {name} @ {width}px ({label}) ==")
                    print(f"   overflow: {'YES +' + str(probe['overflowPx']) + 'px' if probe['horizontalOverflow'] else 'no'}"
                          f" | text: {probe['visibleText']} chars | bg: {probe['bodyBg']}")
                    if probe["stuck"]:
                        print("   outside viewport:", "; ".join(probe["stuck"][:6]))
                    if probe["tinyText"]:
                        print("   tiny text:", ", ".join(probe["tinyText"][:5]))
                    if probe["smallTaps"]:
                        print("   small tap targets:", ", ".join(probe["smallTaps"][:5]))
                    if probe.get("covered"):
                        print("   unclickable/hidden controls:", "; ".join(probe["covered"][:6]))
                    if errors:
                        print("   JS errors:", errors[:3])
                    if failed:
                        print("   failed requests:", failed[:5])
                    real_console = [c for c in console_errors if "favicon" not in c.lower()]
                    if real_console:
                        print("   console errors:", real_console[:3])

                    if probe["horizontalOverflow"] and label == "phone":
                        problems.append(f"{name}/phone: scrolls sideways by {probe['overflowPx']}px")
                    if probe["visibleText"] < 40:
                        problems.append(f"{name}/{label}: almost no visible text ({probe['visibleText']} chars)")
                    if errors:
                        problems.append(f"{name}/{label}: {len(errors)} JS error(s)")
                    if probe["smallTaps"]:
                        problems.append(f"{name}/{label}: {len(probe['smallTaps'])} tap target(s) under 28px")
                    if probe.get("covered"):
                        problems.append(f"{name}/{label}: {len(probe['covered'])} control(s) hidden or covered")
            browser.close()
    finally:
        server.terminate()

    print("\n" + "=" * 60)
    if problems:
        print(f"{len(problems)} REAL problem(s) found:")
        for item in problems:
            print("  -", item)
    else:
        print("No layout/console problems detected.")
    print(f"screenshots: {SHOTS}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
