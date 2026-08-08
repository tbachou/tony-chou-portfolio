#!/bin/bash
# apps/api requires Node >=22 (better-auth needs ESM support), but the
# default `node` on PATH may resolve to an older version. Use nvm to pick up
# the version pinned in .node-version if available.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22 --silent 2>/dev/null || true
exec npm run start:dev --workspace=apps/api
