#!/bin/sh
set -e

# Start Node.js API sidecar (generates nginx config on boot)
node /app/api.js &
API_PID=$!

# Wait for sidecar to write the config
sleep 1

# Validate and start nginx
nginx -t
exec nginx -g 'daemon off;'
