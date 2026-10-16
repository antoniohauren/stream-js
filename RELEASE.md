# Streamroom v0.2.0 — JavaScript server

The current server runs directly with Node.js 22+ (Node 24 LTS recommended). Rust, Cargo, Visual Studio build tools, and the Windows executable build are no longer part of this source tree. The browser client and WebSocket protocol remain compatible.

For an existing VPS, upload the current source including `package-lock.json`, preserve `.env`, and use the same project directory to preserve Caddy volumes:

```bash
sudo docker compose stop app
sudo docker compose up -d
```

For TURN deployments, include `-f compose.yaml -f compose.turn.yaml` in both commands. Compose now uses stock Node images and installs the locked pure-JavaScript dependency into a volume; there is no build step. For changes only to server code, `docker compose restart app` suffices; browser assets are read directly from disk. Restarting disconnects active rooms.

See README.md and DEPLOY-AWS.md for current instructions.

## Historical v0.1.1 release (Rust; superseded)

This release fixes a TURN startup failure caused by a Coturn argument that is unsupported by the pinned 4.18 image. See CHANGELOG.md. The source archive contains a complete Docker build context; the Windows archive contains a portable executable for local hosting. Public AWS hosting uses the Docker source package.

## Update the existing AWS deployment

Upload streamroom-v0.1.1-source.zip to the VPS, then run:

```bash
cd ~/qweqwe/streamroom-turn
unzip -o ~/streamroom-v0.1.1-source.zip
sudo docker compose -f compose.yaml -f compose.turn.yaml up -d --build
sudo docker compose -f compose.yaml -f compose.turn.yaml ps
sudo docker compose -f compose.yaml -f compose.turn.yaml logs --since=1m --tail=60 turn
```

Use the directory containing your existing `.env`. The archive excludes `.env`, preserving the shared secret and IP/domain values. Caddy certificate volumes are also preserved. If the TURN environment has not yet been configured, run the setup script as described in TURN-AWS.md.

Hard-refresh both browsers, leave/rejoin the room, and restart sharing after deploying. Check that Coturn remains running and produces listener/session logs instead of help text. AWS must allow TCP/UDP 3478 and UDP 49160–49200.

## Git history

The release is tagged v0.1.1 in a local repository; it has not been pushed or published to a remote service. A Git bundle contains that repository and tag. Restore it with:

```bash
git clone streamroom-v0.1.1.bundle streamroom
git -C streamroom show v0.1.1
```

Checksums and the exact commit ID are supplied alongside the release packages. See VALIDATION.md for test scope and limitations.
