#!/bin/bash

# Gmail MCP Integration Testing Setup Script
# This script helps set up the environment for testing the Gmail integration

echo "🚀 Gmail MCP Integration Testing Setup"
echo "======================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm are installed"

# Install dependencies
echo "📦 Installing dependencies..."
cd apps/server
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️ .env file not found. Creating template..."
    cat > .env << EOL
# Gmail MCP Configuration
GMAIL_CLIENT_ID="your_gmail_client_id_here"
GMAIL_CLIENT_SECRET="your_gmail_client_secret_here"
GMAIL_PUBSUB_TOPIC="projects/your-project/topics/gmail-notifications"
GMAIL_WEBHOOK_SECRET="your-webhook-secret-here"

# Frontend Configuration
FRONTEND_URL="http://localhost:3000"
EOL
    echo "✅ Created .env template. Please fill in your Gmail credentials."
else
    echo "✅ .env file exists"
fi

# Run database migrations
echo "🗄️ Setting up database..."
cd ../..
cd packages/db
npx prisma migrate dev --name gmail_integration_test

if [ $? -ne 0 ]; then
    echo "❌ Database migration failed"
    exit 1
fi

npx prisma generate

if [ $? -ne 0 ]; then
    echo "❌ Prisma client generation failed"
    exit 1
fi

echo "✅ Database setup complete"

# Go back to server directory
cd ../server

# Check if test script exists
if [ -f "src/test-gmail-integration.ts" ]; then
    echo "✅ Test script found"
else
    echo "❌ Test script not found"
    exit 1
fi

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "To run the Gmail integration tests:"
echo "  cd apps/server"
echo "  npm run test:gmail"
echo ""
echo "To start the development server:"
echo "  npm run dev"
echo ""
echo "To run the frontend:"
echo "  cd ../web"
echo "  npm run dev"
echo ""
echo "📝 Next Steps:"
echo "1. Configure your Gmail OAuth credentials in .env"
echo "2. Set up Google Cloud Pub/Sub (optional)"
echo "3. Run the test script: npm run test:gmail"
echo "4. Test the UI at http://localhost:3000/gmail"
echo ""
echo "📚 For detailed testing instructions, see GMAIL_INTEGRATION_TESTING.md"
