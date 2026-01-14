#!/bin/sh
set -e

echo "🚀 Starting processor service..."
exec bun run dist/src/index.js
