#!/usr/bin/env bash
set -euo pipefail
mkdir -p .work/ai-e2e .work/ai-e2e-res/raw .work/ai-e2e-evidence
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=Mint disposable E2E CA' -addext 'basicConstraints=critical,CA:TRUE' -keyout .work/ai-e2e/ca.key -out .work/ai-e2e/ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj '/CN=10.0.2.2' -keyout .work/ai-e2e/server.key -out .work/ai-e2e/server.csr 2>/dev/null
cat > .work/ai-e2e/server.ext <<'EXT'
subjectAltName=IP:10.0.2.2,IP:127.0.0.1,DNS:localhost
extendedKeyUsage=serverAuth
basicConstraints=CA:FALSE
EXT
openssl x509 -req -in .work/ai-e2e/server.csr -CA .work/ai-e2e/ca.pem -CAkey .work/ai-e2e/ca.key -CAcreateserial -days 2 -extfile .work/ai-e2e/server.ext -out .work/ai-e2e/server.pem 2>/dev/null
cp .work/ai-e2e/ca.pem .work/ai-e2e-res/raw/mint_e2e_ca.pem
