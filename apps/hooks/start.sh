#!/bin/sh
set -e

echo "🔧 Building @repo/email package..."
cd /opt/render/project/src/packages/email
npm run build || echo "Email package build skipped"

echo "🔧 Building hooks service with SWC..."
cd /opt/render/project/src/apps/hooks
npx swc src -d dist --copy-files

echo "🚀 Starting hooks service..."
node dist/index.js
