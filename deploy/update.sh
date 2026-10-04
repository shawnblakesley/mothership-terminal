#!/usr/bin/env bash
# Deploy the latest code from GitHub. Run on the server: sudo bash /opt/mothership/deploy/update.sh
# Sessions survive; Wardens re-enter API keys (or their browser re-sends remembered ones).
set -euo pipefail
cd /opt/mothership
sudo -u mothership git pull --ff-only
sudo -u mothership npm ci --omit=dev
systemctl restart mothership
sleep 2
systemctl --no-pager --lines=5 status mothership
