#!/bin/sh
set -e

echo "🚀 Starting hooks service..."
exec node dist/src/index.js
