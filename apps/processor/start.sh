#!/bin/sh
set -e

echo "🚀 Starting processor service..."
exec node dist/src/index.js
