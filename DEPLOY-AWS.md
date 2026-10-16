# Build-free VPS deployment (Ubuntu / AWS)

The app runs directly from JavaScript in a stock Node 24 image behind Caddy HTTPS. **No Rust, compilation, bundling, or Docker image build is required.** Docker Engine and the Docker Compose plugin must already be installed; see [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).

## 1. DNS and firewall

Point your domain's A record at the VPS public IPv4 address. Use DNS-only mode initially; do not add AAAA unless IPv6 is configured. For AWS, use a stable Elastic IP if needed (AWS usage/IP/data-transfer charges apply).

Allow inbound TCP 22 only from your own IP, and TCP 80/443 from clients/the Internet, in both the AWS security group and host firewall. Leave outbound connectivity available for image/package downloads and certificate issuance. Do not expose TCP 8787; it stays on the internal Compose network. TURN needs additional ports described in TURN-AWS.md.

## 2. Upload and configure

Copy this entire `stream-js` project into `~/Projects/stream-js` on your VPS (including `.env.example`). You do not need local `node_modules` or any compiled files. This project is self-contained; it does not need the original Rust project.

```bash
cd ~/Projects/stream-js
cp .env.example .env
nano .env
```

Set your real values (no `https://` prefix or path):

```dotenv
DOMAIN=share.example.com
ACME_EMAIL=you@example.com
```

**Existing deployment:** use your existing project directory and preserve `.env`. Do not overwrite it with `.env.example`, change the Compose project name, or remove certificate volumes. Existing TURN environment variables and `setup-turn.sh` remain compatible.

## 3. Start

```bash
sudo docker compose config --quiet
sudo docker compose up -d
sudo docker compose ps -a
sudo docker compose logs --tail=100 app caddy
curl -fsS https://share.example.com/health
```

Replace the domain in curl; it should print `ok`. The one-shot `dependencies` service runs locked `npm ci --omit=dev --ignore-scripts` into a named volume and exits with status 0. The app starts afterward as the unprivileged `node` user; Caddy waits for its health check. Package installation requires Internet access, but no install scripts or native compilation run. Subsequent container restarts reuse installed dependencies. Caddy provisions and renews certificates automatically and preserves the Host header for the origin check.

For TURN, use `-f compose.yaml -f compose.turn.yaml` on **every** Compose command; see TURN-AWS.md first.

## 4. Update an existing deployment

Upload/pull the new source, preserving `.env`. Keep the same directory/project name so existing Caddy certificates remain available. This also migrates from the old Rust image:

```bash
sudo docker compose stop app
sudo docker compose up -d
sudo docker compose ps -a
```

Stopping first prevents a dependency reinstall from modifying the shared dependency volume while the old app is using it. No `--build` is needed. Keep only one app replica; room state is in memory and all restarts interrupt rooms.

For server-code-only changes, use `sudo docker compose restart app`. Browser assets are read from disk on each request; refresh the browser after uploading changes to `web/`. For environment/Compose changes, use `up -d` instead of `restart`. If dependency installation fails, inspect `docker compose logs dependencies`, fix connectivity/configuration, and rerun the update commands.

## 5. Use and operate

Open your public HTTPS URL in Edge or Chrome on both machines. Create a room, copy its invite, and test screen sharing and sound. No desktop executable is needed. The base deployment relays signaling/chat only, not media; add Coturn if room/chat works but media fails.

```bash
sudo docker compose logs --tail=100 app
sudo docker compose logs -f
# Stop containers while retaining dependency/certificate volumes:
sudo docker compose down
```

Do not use `down -v` for routine maintenance: it deletes Caddy certificate state as well as installed dependencies. App and Caddy restart automatically with Docker unless explicitly stopped. A normal container restart needs no npm/network access.

Troubleshooting:

- Certificate failure: check DNS, TCP 80/443, Caddy logs, and conflicting listeners.
- WebSocket 403: the browser and socket must use the same public origin; preserve the Host header in additional proxies.
- App startup failure: check `dependencies` exit status/logs and `app` logs. The stock images support common VPS architectures.
- Lost rooms after deploy: expected; rejoin after restarting the server.
- No sound: select an audio-capable capture source and Share audio; viewers may need Enable playback & audio.

Docker/Caddy/Coturn startup and actual browser media traversal have not been exercised in this development environment. Follow VALIDATION.md and test your deployment before relying on it. The app has no accounts; add access control before exposing it beyond trusted small groups.
