#!/usr/bin/env bash
# One-shot setup for the browser QA harness (tests/qa_browser_check.py).
#
# The sandbox does not keep anything installed outside /home/user, so this has
# to be re-run at the start of every session that wants to measure the web UI.
#
#   bash tests/qa_setup.sh
set -e
echo "> installing the playwright python package"
pip install -q playwright
echo "> downloading chromium (~120 MB, takes a while)"
python3 -m playwright install chromium
echo "> installing the system libraries chromium needs"
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  sudo -n apt-get update -qq
  sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0
else
  echo "  (no sudo - if chromium fails to start with a missing .so, install those libs yourself)"
fi
echo "> done. run:  python3 tests/qa_browser_check.py"
