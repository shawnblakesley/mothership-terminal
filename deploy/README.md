# Hosting under a path on an existing site

This is how [shawnofthe.dev/mothership](https://shawnofthe.dev/mothership/) is wired. The main site is static: S3 behind CloudFront. The terminal needs a running server, so CloudFront sends just `/mothership*` to it.

```
                           ┌── /*            → S3 bucket (the static site, unchanged)
viewer ── HTTPS ── CloudFront
                           └── /mothership*  → https://mothership-origin.shawnofthe.dev
                                                (Lightsail: Caddy → Node on :3000)
```

## 1. Server (Lightsail, Ubuntu 24.04, 1 GB plan)

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

Updates later:

```bash
sudo bash /opt/mothership/deploy/update.sh
```

## 2. CloudFront

On the existing distribution:

1. **Origin:** add `mothership-origin.shawnofthe.dev`, with protocol **HTTPS only** and the custom header `X-Origin-Secret: <secret>`.
2. **Behavior:** add path pattern `/mothership*` → that origin, with these settings:

| Setting | Value |
|---|---|
| Viewer protocol | Redirect HTTP to HTTPS |
| Allowed methods | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE |
| Cache policy | `CachingDisabled` |
| Origin request policy | `AllViewerAndCloudFrontHeaders-2022-06`. This forwards the WebSocket upgrade headers and `CloudFront-Viewer-Address`, which the server uses for rate limiting. |

## Notes

- **Disk:** sessions live in `/var/lib/mothership/sessions/`. API keys are never on disk.
- **Logs:**
  ```bash
  journalctl -u mothership -f
  ```
- **Limits:** set in the systemd unit. `MAX_SESSIONS` defaults to 300, and idle sessions expire after `SESSION_TTL_DAYS` (default 14).
