#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $# != 2 ]]; then
  echo 'Usage: bash setup-turn.sh PUBLIC_IPV4 PRIVATE_IPV4' >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo 'Configure DOMAIN and ACME_EMAIL in .env first.' >&2
  exit 1
fi
command -v openssl >/dev/null || { echo 'Install openssl first.' >&2; exit 1; }
umask 077
# Re-running preserves the existing secret, so temporary credentials keep working.
secret=$(sed -n 's/^TURN_SECRET=//p' .env | tail -n 1)
if [[ ${#secret} -lt 32 ]]; then secret=$(openssl rand -hex 32); fi
temporary=$(mktemp .env.turn.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT
awk '!/^(TURN_PUBLIC_IP|TURN_PRIVATE_IP|TURN_SECRET|STREAMROOM_ICE_POLICY)=/' .env > "$temporary"
printf '\nTURN_PUBLIC_IP=%s\nTURN_PRIVATE_IP=%s\nTURN_SECRET=%s\nSTREAMROOM_ICE_POLICY=relay\n' "$1" "$2" "$secret" >> "$temporary"
mv -- "$temporary" .env
echo 'TURN settings saved in .env. Open the AWS relay ports, then start both Compose files.'
