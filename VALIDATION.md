# Validation status

JavaScript rewrite checks completed locally:

- `npm ci --ignore-scripts`: installs the locked pure-JavaScript `ws` dependency without build scripts.
- `npm test`: 22 tests pass (12 mocked client behavior tests and 10 server tests).
- Actual loopback HTTP and WebSocket connections verify assets/health, same-origin upgrades, input validation, joining, chat broadcasts, presenter arbitration, signaling restrictions, departure cleanup, room capacity, TURN welcome credentials, rate limits, and oversized payload rejection.
- Coturn HMAC-SHA1 credentials match the original Rust server's reference vector.
- Configuration tests reject invalid bind addresses, unsupported ICE policies, missing TURN secrets, and incomplete direct TLS configuration.

Not verified here:

- Docker Compose startup: the installed Docker CLI has no Compose plugin. The build-free deployment, Caddy certificates, container hardening/health checks, and Coturn must be tested on the target VPS.
- Real HTTPS certificate loading, browser screen capture, audible source/microphone audio, sustained frame rate, and two-machine/actual TURN traversal.
- Load testing and slow-client/90-second idle timeout behavior.

Repeat with `npm ci --ignore-scripts` and `npm test`. See README.md for manual browser acceptance and TURN-AWS.md for relay verification. Earlier Rust/Windows release results in historical release notes do not validate this Node version.
