#!/bin/sh
set -e

echo "🚀 Starting worker service..."
exec node dist/src/index.js
