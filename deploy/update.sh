#!/usr/bin/env bash
# Deploy new code from GitHub and restart. Normally run by the CDK deploy
# (MothershipStack in monster-land, through AWS Systems Manager) with the commit
# to deploy; by hand, it deploys the latest main:
#
#   sudo bash /opt/mothership/deploy/update.sh [commit]
#
# Sessions survive; Wardens re-enter API keys (or their browser re-sends remembered ones).
set -euo pipefail
cd /opt/mothership
git config --global --add safe.directory /opt/mothership 2>/dev/null || true
if [ -n "${1:-}" ]; then
  sudo -u mothership git fetch -q origin
  sudo -u mothership git checkout -q --detach "$1"
else
  sudo -u mothership git checkout -q main
  sudo -u mothership git pull -q --ff-only
fi
sudo -u mothership npm ci --omit=dev --no-audit --no-fund
systemctl restart mothership

# Wait for the app to answer before calling it deployed.
base=$(systemctl show mothership -p Environment --value | tr ' ' '\n' | sed -n 's/^BASE_PATH=//p')
for _ in $(seq 30); do
  if curl -fsS "http://127.0.0.1:3000${base}/healthz" >/dev/null 2>&1; then
    echo "Deployed $(sudo -u mothership git log --oneline -1)"
    exit 0
  fi
  sleep 2
done
systemctl --no-pager --lines=20 status mothership
exit 1
