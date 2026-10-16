# Changelog

## Unreleased

- Add an optional single-file Windows 11 WebView2 client for `https://share.detrouse.com/`, with an original icon and an explicit Edge fallback. It does not bundle a browser or change the Node server deployment.

## 0.2.0

- Replace the Rust server with plain JavaScript running on Node.js, preserving rooms, chat, WebSocket signaling, same-origin checks, TLS, and temporary TURN credentials.
- Deploy with stock Node images and bind-mounted source; no compilation or Docker image build on the VPS.
- Add live HTTP/WebSocket integration tests alongside the existing browser-client tests.
- Remove the Rust toolchain and Windows executable build requirement. Open the HTTPS site directly in a browser.

## 0.1.1

Fix Coturn startup in the AWS Docker Compose deployment. Remove the unsupported `--no-dtls` argument, which caused Coturn 4.18 to print help and exit, and remove deprecated `--no-cli`. DTLS and CLI remain disabled by default. Preserve the pinned Coturn image, temporary relay credentials, IP mapping, and relay port range.

The release includes automatic TURN credentials from the Rust signaling server, the optional TURN Compose override, and the setup script introduced during deployment troubleshooting.

Validation: three Rust unit tests, eleven client behavior tests, and Windows release compilation. Live Docker/Coturn relay traversal still requires verification on the VPS.
