#!/bin/sh
set -eu

# The bind-mounted data directory may be owned by root on first boot. Fix it,
# then drop privileges before starting the Node process.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  exec gosu node "$@"
fi

exec "$@"
