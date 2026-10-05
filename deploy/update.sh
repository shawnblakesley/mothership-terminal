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

# Usage telemetry: the CloudWatch agent takes the app's metric records
# (telemetry.js sends them to it on 127.0.0.1:25888) to CloudWatch, into the
# /mothership/telemetry log group and the "Mothership" metrics behind the
# dashboard (MothershipStack in monster-land). It signs in with the credentials
# the Systems Manager agent keeps for this server (root only); the app itself
# never holds AWS credentials. Telemetry never blocks a deploy.
setup_telemetry() {
  local dir=/opt/aws/amazon-cloudwatch-agent
  if [ ! -x "$dir/bin/amazon-cloudwatch-agent-ctl" ]; then
    curl -fsSL -o /tmp/amazon-cloudwatch-agent.deb \
      "https://amazoncloudwatch-agent-us-west-2.s3.us-west-2.amazonaws.com/ubuntu/$(dpkg --print-architecture)/latest/amazon-cloudwatch-agent.deb"
    dpkg -i -E /tmp/amazon-cloudwatch-agent.deb
    rm -f /tmp/amazon-cloudwatch-agent.deb
  fi
  cat > "$dir/etc/common-config.toml" <<'TOML'
[credentials]
  shared_credential_profile = "default"
  shared_credential_file = "/root/.aws/credentials"
TOML
  # Only the app's metric records: no other logs or files leave the server.
  cat > "$dir/etc/mothership.json" <<'JSON'
{
  "agent": { "region": "us-west-2", "run_as_user": "root", "metrics_collection_interval": 60 },
  "logs": {
    "metrics_collected": { "emf": {} },
    "force_flush_interval": 15
  }
}
JSON
  # (Off AWS the agent can't discover its region; the config step needs it in the environment.)
  HOME=/root AWS_REGION=us-west-2 AWS_DEFAULT_REGION=us-west-2 \
    "$dir/bin/amazon-cloudwatch-agent-ctl" -a fetch-config -m onPremise -s -c "file:$dir/etc/mothership.json" >/dev/null
}
setup_telemetry || echo "Telemetry setup failed (the app runs without it)." >&2

# Secrets (the OpenRouter key for free models) come from SSM Parameter Store
# into a root-only file the unit loads; nothing secret is in the repo or the
# deploy. If they can't be fetched, the ones from the last deploy stay.
mkdir -p /etc/systemd/system/mothership.service.d
cat > /etc/systemd/system/mothership.service.d/secrets.conf <<'CONF'
[Service]
EnvironmentFile=-/etc/mothership/secrets.env
CONF
systemctl daemon-reload
HOME=/root node deploy/secrets.mjs /etc/mothership/secrets.env || echo "Couldn't fetch secrets; keeping the last ones." >&2

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
