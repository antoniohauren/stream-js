# Streamroom

Three open screen-sharing rooms with a simple sidebar and video interface. The server and browser client are plain JavaScript: **no compilation, bundler, or build step**. The Node server handles rooms and WebRTC signaling; audio/video travels peer-to-peer or through your TURN relay.

## Run directly

Install Node.js 22+ (24 LTS recommended), then from this project directory:

```bash
cd ~/Projects/stream-js
npm ci --omit=dev --ignore-scripts
npm start
```

Open `http://localhost:8787` in Edge or Chrome. Stop with Ctrl+C. There is no Windows executable or automatic browser launcher anymore; open the site directly. Existing desktop launchers that open your public site can still use it.

The default bind address is loopback. For Internet use, put Caddy or another trusted HTTPS reverse proxy in front of it. Screen capture requires HTTPS except on localhost. Preserve the Host header and support WebSocket upgrades on `/ws/`.

## VPS: no image build

The included Compose configuration uses stock Node and Caddy images. It installs the single, pure-JavaScript `ws` dependency into a named volume using the lockfile, then runs the source as an unprivileged user with read-only mounts. No Rust, compiler, or custom Docker image is needed.

```bash
cd ~/Projects/stream-js
cp .env.example .env
# Edit .env: set DOMAIN and ACME_EMAIL; point DNS at your VPS first.
docker compose up -d
```

Allow TCP 80/443 to the VPS. Do not publish port 8787. See [DEPLOY-AWS.md](DEPLOY-AWS.md) for deployment and updates, including migration from the Rust version. For networks needing a media relay, see [TURN-AWS.md](TURN-AWS.md).

After changing `server.js`, restart the app; browser files are served directly from `web/` and only need a browser refresh. After changing dependencies, stop the app and run Compose up again so the dependency installer finishes before the app starts. Server restarts interrupt active rooms.

## Features and use

- Three precreated rooms in the sidebar: `room-1`, `room-2`, and `room-3`. Up to eight participants per room, one presenter at a time.
- Screen/window/tab capture at 720p or 1080p, targeting 30 fps.
- Source audio when offered by the browser picker; optional microphone mixing.
- Copyable room links, stop-sharing and leave controls; click another room to switch.
- No room tokens, chat, accounts, database, recordings, or external client JavaScript.

Choose a room in the sidebar, enter your display name, and click **Join room**. Once your name is entered, clicking a room joins it directly. Room links preselect the room; there is no code to enter. Everyone must use the same public server address. Choose your quality, click **Share screen**, and enable **Share audio** in the picker if available. Viewers may need **Enable playback & audio** due to autoplay rules. The local preview is muted to prevent feedback. Switching rooms stops any active screen share.

## Configuration

Direct Node execution reads environment variables from the process, not automatically from `.env`. Use `node --env-file=.env server.js` if desired. Compose reads `.env` for domain/TURN substitutions; the base Compose file explicitly binds the app to `0.0.0.0:8787` inside its private network.

| Variable | Default / purpose |
| --- | --- |
| `STREAMROOM_BIND` | `127.0.0.1:8787`; IP:port, or `[IPv6]:port` |
| `STREAMROOM_CERT`, `STREAMROOM_KEY` | Optional PEM certificate/key paths for direct HTTPS; set both |
| `STREAMROOM_TURN_URLS` | Comma-separated TURN URLs |
| `TURN_SECRET` | Coturn shared secret, at least 32 characters when TURN is enabled |
| `STREAMROOM_ICE_POLICY` | `all`, or `relay` with TURN configured |

TURN credentials are generated per participant, expire after 24 hours, and never reveal the shared secret. Rejoin to refresh them. The client also supports an external TURN configuration via the `streamroom-turn` localStorage key, containing `{urls, username, credential}`. Use short-lived credentials.

## Practical limits and security

- Rooms are public to anyone with site access; room names and links are not secrets or authentication. Use trusted small groups or add access control before wider exposure.
- One process/replica only: three fixed rooms, eight peers per room, with in-memory state. Empty rooms remain available; restarts disconnect participants. There is no automatic reconnect, moderation, SFU, or bidirectional voice chat.
- Media is WebRTC-encrypted. Each viewer gets a separate stream: seven viewers at the 6 Mbps 1080p ceiling may need roughly 42 Mbps of presenter upload plus overhead. TURN adds VPS bandwidth and transfer costs.
- Quality is an upper bound, not a guarantee. Source dimensions, hardware, upload bandwidth, and congestion control affect actual quality; smaller sources are not upscaled.
- Capture requests `windowAudio: "window"` and `systemAudio: "exclude"`. Actual audio availability/isolation depends on the browser and OS. If window audio is unavailable, try a browser tab. Verify isolation with a second app playing sound.
- Google's public STUN service is used by default. Some networks need TURN; HTTPS-only corporate networks may require a separate TURN-over-TLS endpoint.
- The server enforces same-origin WebSocket upgrades, 64 KiB messages, rate limits, idle timeouts, bounded outgoing buffers, and presenter-only signaling paths. These are not a substitute for authentication or edge-level abuse controls.

## Verification

```bash
npm ci --ignore-scripts
npm test
```

Tests include mocked browser behavior and real local HTTP/WebSocket connections. See [VALIDATION.md](VALIDATION.md) for scope. Manual acceptance: join two browsers in the same room, share at both quality settings with sound/mic, join a third viewer, stop via both app and browser picker, and close the presenter. Switch between all three sidebar rooms and verify that capture stops and participants stay isolated. Repeat between two machines over HTTPS and verify TURN where required.

## Files

- `server.js`: HTTP/HTTPS, fixed rooms, WebSocket signaling, TURN credentials.
- `web/`: existing browser interface, WebRTC negotiation, capture, and audio mixing; served without a build.
- `compose.yaml`: build-free Node/Caddy deployment; `compose.turn.yaml`: optional Coturn service.
- `Dockerfile`: optional custom-image packaging for those who want it; not used by Compose.
