#!/bin/sh
set -e

echo "🌱 Checking if database needs seeding..."

# Run seed script (it uses upsert so it's safe to run multiple times)
node dist/src/seed.js 2>/dev/null || echo "⚠️ Seed script not found or already seeded"

echo "🚀 Starting server..."
exec node dist/src/index.js
