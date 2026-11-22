#!/usr/bin/env bash
# Redeploys Kopi on a remote Docker host: pulls the latest commit there and rebuilds the container.
#
# The server must already have a git clone of this repo with a filled-in .env (see README).
# Configure it with environment variables, or put them in a git-ignored .env.deploy file:
#   DEPLOY_HOST=user@my-server         # anything `ssh` accepts, including a Host alias from ~/.ssh/config
#   DEPLOY_DIR=apps/actual-companion   # path of the clone on the server; relative paths and ~ are
#                                      # resolved on the server, from the SSH user's home directory
#   DEPLOY_BRANCH=main                 # optional, defaults to main
# Environment variables take precedence over .env.deploy.
set -euo pipefail

cd "$(dirname "$0")"
if [ -f .env.deploy ]; then
  # Read KEY=value lines literally (not sourced) so ~ isn't expanded on this machine.
  while IFS='=' read -r key value; do
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    case "$key" in
      DEPLOY_HOST|DEPLOY_DIR|DEPLOY_BRANCH) [ -n "${!key:-}" ] || printf -v "$key" '%s' "$value" ;;
    esac
  done < <(tr -d '\r' < .env.deploy | grep -E '^[A-Z_]+=')
fi

: "${DEPLOY_HOST:?Set DEPLOY_HOST (e.g. user@my-server)}"
: "${DEPLOY_DIR:?Set DEPLOY_DIR (path of the clone on the server)}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

echo "Deploying ${DEPLOY_BRANCH} to ${DEPLOY_HOST}:${DEPLOY_DIR}..."
ssh "$DEPLOY_HOST" bash -se <<EOF
set -euo pipefail
cd ${DEPLOY_DIR}
git fetch --prune origin
git checkout ${DEPLOY_BRANCH}
git pull --ff-only origin ${DEPLOY_BRANCH}
mkdir -p data
docker compose up -d --build
docker compose ps
EOF
echo "Deployment complete."
