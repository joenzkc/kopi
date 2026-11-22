#!/usr/bin/env bash
# Redeploys Kopi on a remote Docker host: pulls the latest commit there and rebuilds the container.
#
# The server must already have a git clone of this repo with a filled-in .env (see README).
# Configure it with environment variables, or put them in a git-ignored .env.deploy file:
#   DEPLOY_HOST=user@my-server         # anything `ssh` accepts, including a Host alias from ~/.ssh/config
#   DEPLOY_DIR=~/apps/actual-companion # path of the clone on the server
#   DEPLOY_BRANCH=main                 # optional, defaults to main
set -euo pipefail

cd "$(dirname "$0")"
if [ -f .env.deploy ]; then
  set -a
  . ./.env.deploy
  set +a
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
