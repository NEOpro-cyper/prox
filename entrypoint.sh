#!/bin/sh

# Start Node.js API sidecar (generates nginx config on boot)
node /app/api.js &
API_PID=$!

# Wait for sidecar to write the config
sleep 1

# Validate nginx config
echo "[ENTRY] Testing nginx config..."
if ! nginx -t 2>&1; then
    echo "[ENTRY] FATAL: nginx config invalid, exiting"
    exit 1
fi

# Start nginx in foreground
echo "[ENTRY] Starting nginx..."
exec nginx -g 'daemon off;'
