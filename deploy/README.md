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
- **Limits:** set in the systemd unit. `MAX_SESSIONS` defaults to 300, and idle sessions expire after `SESSION_TTL_DAYS` (default 14).
