# Hosting under a path on an existing site

This is how [shawnofthe.dev/mothership](https://shawnofthe.dev/mothership/) is wired. The main site is static: S3 behind CloudFront. The terminal needs a running server, so CloudFront sends just `/mothership*` to it.

**Infrastructure as code:** the AWS side lives in the CDK app in the private `monster-land` repo (`cdk/lib`). **MothershipStack** owns the Lightsail instance (`mothership-2gb`), its static IP (`mothership-ip`) and the `mothership-origin` DNS record; **PortfolioStack** and **WebsiteStack** own the CloudFront distributions for shawnofthe.dev and monster.land, including their `/mothership` routes. The origin secret is read at deploy time from SSM Parameter Store (`/mothership/origin-secret`), never stored in code. Change infrastructure there, not by hand. The steps below are how it was first set up, and what to do on a fresh server.

**Deploys are automatic.** A push to `main` here runs `.github/workflows/deploy.yml`, which points monster-land's `mothership-terminal` submodule at the new commit. That push deploys monster-land, and MothershipStack checks out the commit on the server through AWS Systems Manager, runs `deploy/update.sh` and fails the deploy if the app doesn't come back healthy.

```
                           ┌── /*            → S3 bucket (the static site, unchanged)
viewer ── HTTPS ── CloudFront
                           └── /mothership/* → https://mothership-origin.shawnofthe.dev
                                                (Lightsail: Caddy → Node on :3000)
```

## 1. Server (Lightsail, Ubuntu 24.04, 2 GB plan)

Use at least 2 GB of RAM: the human-voice model at full precision needs about 650 MB, and on a 1 GB plan the server swaps and the first line after a quiet spell can stall. The 1 GB plan also runs out of burst CPU quickly.

1. Create the instance and attach a **static IP**.
2. Open ports **80** and **443** in the instance firewall. Caddy needs 80 for the certificate.
3. In Route 53, add an **A record**: `mothership-origin.shawnofthe.dev` → the static IP.
4. Generate a random origin secret:
   ```bash
   openssl rand -hex 24
   ```
5. On the server, run:
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/shawnblakesley/mothership-terminal/main/deploy/setup.sh
   sudo ORIGIN_DOMAIN=mothership-origin.shawnofthe.dev ORIGIN_SECRET=<secret> bash setup.sh
   ```
6. Register the server with Systems Manager, so deploys can reach it without SSH. The agent comes preinstalled on Lightsail's Ubuntu images; the role is `mothership-server-ssm` from MothershipStack. From a machine with AWS credentials:
   ```bash
   aws ssm create-activation --iam-role mothership-server-ssm --default-instance-name mothership-2gb --registration-limit 1 --region us-west-2
   ```
   Then, on the server, with the code and ID it prints:
   ```bash
   sudo snap stop amazon-ssm-agent
   sudo /snap/amazon-ssm-agent/current/amazon-ssm-agent -register -y -code <code> -id <id> -region us-west-2
   sudo snap start amazon-ssm-agent
   ```

To deploy by hand (latest `main`, or a given commit):

```bash
sudo bash /opt/mothership/deploy/update.sh [commit]
```

## 2. CloudFront

On the existing distribution:

1. **Origin:** add `mothership-origin.shawnofthe.dev`, with protocol **HTTPS only** and the custom header `X-Origin-Secret: <secret>`.
2. **Behavior:** add path patterns `/mothership` and `/mothership/*` → that origin, with these settings:

| Setting | Value |
|---|---|
| Viewer protocol | Redirect HTTP to HTTPS |
| Allowed methods | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE |
| Cache policy | `CachingDisabled` |
| Origin request policy | `AllViewerExceptHostHeader`. This forwards the WebSocket upgrade headers but not `Host`, which must stay the origin name so its certificate matches. CloudFront's `X-Forwarded-For` (always sent) gives the server the real viewer IP for rate limiting. |

## Notes

- **Disk:** sessions live in `/var/lib/mothership/sessions/`. API keys are never on disk.
- **Logs:**
  ```bash
  journalctl -u mothership -f
  ```
  Every line is redacted before it's printed (`redact.js`): LLM keys never appear in them.
- **Deploy speed:** a push here only bumps the submodule in monster-land, whose workflow then builds and deploys just MothershipStack (no site builds, no change sets, `--exclusively`); a change to monster-land's own `cdk/` deploys everything. On the server, `update.sh` skips `npm ci` unless `package-lock.json` changed.
- **Usage dashboard:** CloudWatch → Dashboards → **Mothership** (us-west-2), from MothershipStack. `deploy/update.sh` installs the CloudWatch agent and points it at the app's telemetry (`telemetry.js`, sent to the agent on 127.0.0.1:25888), which lands in the `/mothership/telemetry` log group (kept 3 months) and the `Mothership` metrics. The agent signs in with the credentials the Systems Manager agent keeps for the server (`/root/.aws/credentials`), and the server role may write to that log group only. Nothing else on the server is shipped. Telemetry problems never fail a deploy; check the agent with `sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status`.
- **Secrets:** the OpenRouter key (for **Free (shared)** on the start screen) is a SecureString in SSM Parameter Store, `/mothership/openrouter-api-key`, never in the repo or a deploy workflow. Each deploy, `update.sh` runs `deploy/secrets.mjs`, which reads it with the server's role (MothershipStack lets it read that parameter only) into the root-only `/etc/mothership/secrets.env` that the unit loads. Two more parameters turn on the site Claude key (see the app README, API keys): `/mothership/anthropic-api-key` (`ANTHROPIC_API_KEY`) and `/mothership/claude-key-password` (`CLAUDE_KEY_PASSWORD`); each is read the same way and left unset if missing. MothershipStack (private monster-land repo) grants SSM read per parameter, so both of those names must be added to the server role there before the deploy can read them. To set or change the OpenRouter key, from a machine with AWS access:
  ```bash
  read -rs KEY && aws ssm put-parameter --region us-west-2 --name /mothership/openrouter-api-key --type SecureString --value "$KEY" --overwrite; unset KEY
  ```
- **Sound pack:** the built-in sounds (`sounds.js`, `KIT`) aren't in git; their licence doesn't allow sharing the files on their own. They're in the private bucket `mothership-sounds-773206830395` (us-west-2), under `sounds/`. MothershipStack owns the bucket (private, blocked from public access) and lets the server's role read `sounds/*`. Each deploy, `update.sh` runs `deploy/sounds.mjs`, which downloads any that are missing into `public/sounds/` with the role's credentials; until it can, stories go without them. To upload or replace them, from a machine with AWS access and the files in `public/sounds/`:
  ```bash
  aws s3 cp public/sounds/ s3://mothership-sounds-773206830395/sounds/ --recursive --exclude "*" --include "*.mp3"
  ```
  For local development, `node deploy/sounds.mjs` fetches them with your own AWS credentials.
- **Roll tables:** character creation's loadout, trinket and patch tables (`data/tables/psg-tables.json`, made from your own Player's Survival Guide PDF by `scripts/extract-psg-tables.mjs`) aren't in git either. They're in the same private bucket under `rules/`, which MothershipStack lets the server's role read (`rules/*`). Each deploy, `update.sh` runs `deploy/tables.mjs`, which fetches them into `/var/lib/mothership/tables/`; until it can, character creation asks players to look the results up. To upload or replace them:
  ```bash
  aws s3 cp data/tables/psg-tables.json s3://mothership-sounds-773206830395/rules/psg-tables.json
  ```
  then redeploy (any push to main). Delete the parameter and redeploy to turn free models off. If the fetch fails, the deploy keeps the last key.
  Free models cost nothing, so a public server is fine. OpenRouter allows far more free requests a day on an account that has bought at least $10 of credit at some point. Each session is also capped at `FREE_CALLS_PER_DAY` (default 150).
- **Limits:** set in the systemd unit. `MAX_SESSIONS` defaults to 300, and idle sessions expire after `SESSION_TTL_DAYS` (default 14).
