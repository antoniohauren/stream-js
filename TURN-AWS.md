# Fix media connection failures with TURN on this AWS VPS

The website and WebSocket room connection can work while direct WebRTC media fails. A TURN relay provides a media path through the VPS. This update supplies Coturn and automatically sends temporary TURN credentials in the room welcome message. The shared secret remains on the server. Relay-only mode is the default in the TURN override so the first test exercises the relay.

## 1. Configure TURN

Upload or clone the current source to the VPS as described in DEPLOY-AWS.md. In the directory containing your existing `.env`, run with your actual public/private IPs:

```bash
cd ~/Projects/stream-js
bash setup-turn.sh YOUR_PUBLIC_IP YOUR_PRIVATE_IP
```

Preserve your existing `.env` when uploading updates. The script adds the public/private IP mapping and generates a random shared secret; it preserves a valid existing secret if re-run. Keep `.env` private. Do not paste `docker compose config` output publicly because it contains the secret.

If your instance's IPs change, rerun the script with the new public/private addresses. This configuration requires host networking on Ubuntu/Linux.

## 2. Open relay ports in AWS

Add these inbound rules to the same EC2 security group, keeping SSH and HTTP/HTTPS rules:

| Type | Protocol | Port range | Source |
| --- | --- | --- | --- |
| Custom TCP | TCP | 3478 | 0.0.0.0/0 |
| Custom UDP | UDP | 3478 | 0.0.0.0/0 |
| Custom UDP | UDP | 49160–49200 | 0.0.0.0/0 |

If UFW is active, also allow these ports there. Keep normal outbound connectivity; custom network ACLs must also permit relay traffic and return traffic. UDP relay ports are required even when a browser connects to Coturn using TCP. This setup does not add TLS TURN on port 443; Caddy already uses that port. Corporate networks allowing only HTTPS may need a TURN-over-TLS service on a separate IP or provider.

## 3. Start the updated app and relay

```bash
cd ~/Projects/stream-js
sudo docker compose -f compose.yaml -f compose.turn.yaml config --quiet
sudo docker compose -f compose.yaml -f compose.turn.yaml stop app
sudo docker compose -f compose.yaml -f compose.turn.yaml up -d
sudo docker compose -f compose.yaml -f compose.turn.yaml ps
sudo docker compose -f compose.yaml -f compose.turn.yaml logs --tail=60 turn app
```

Always include both `-f` options for managing this deployment. Use `docker compose ... up -d`, rather than restart, after changing environment values. No compilation or image build is required. Caddy keeps its existing certificate volumes.

## 4. Reconnect both browsers

Open your public HTTPS URL in Edge/Chrome on both PCs, press Ctrl+Shift+R, then leave and rejoin the room. The app supplies TURN credentials automatically; browser-console configuration is not required. Start sharing again, beginning with 720p.

Temporary credentials expire 24 hours after joining; leave/rejoin before starting a new sharing session after that point. You can verify a relayed candidate pair in `chrome://webrtc-internals` or `edge://webrtc-internals` while sharing. For a failed relay allocation, check Coturn logs and the AWS rules; a generic ICE failure is not by itself proof of a NAT problem.

After the relay works, change `STREAMROOM_ICE_POLICY=relay` to `STREAMROOM_ICE_POLICY=all` in `.env` and rerun the two-file Compose up command. This allows direct media where possible and relay fallback elsewhere. Rejoin both clients after changes.

## Limits and validation

The relay carries video/audio, so VPS bandwidth usage and AWS data-transfer costs increase. The app currently has no accounts: people able to join rooms can obtain temporary relay credentials. Coturn limits allocations, blocks private/loopback/metadata peers, and disables its CLI. Use this deployment with trusted small groups; add access control for broader public use.

Run `npm ci --ignore-scripts` and `npm test` for the client and Node server tests, including the HMAC-SHA1 credential reference and actual WebSocket TURN welcome messages. Live Coturn traversal has not been verified here; test two peers on your deployment. See VALIDATION.md.

References: [Coturn Docker host networking](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md), [Coturn external address mapping and authentication](https://github.com/coturn/coturn/wiki/turnserver).
