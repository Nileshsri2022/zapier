@echo off
REM Gmail MCP Integration Testing Setup Script for Windows
REM This script helps set up the environment for testing the Gmail integration

echo 🚀 Gmail MCP Integration Testing Setup
echo ======================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

echo ✅ Node.js and npm are installed
echo.

REM Install dependencies
echo 📦 Installing dependencies...
cd apps\server
if exist package-lock.json (
    npm ci
) else (
    npm install
)

if %errorlevel% neq 0 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)

echo ✅ Dependencies installed
echo.

REM Check if .env file exists
if not exist .env (
    echo ⚠️ .env file not found. Creating template...
    (
        echo # Gmail MCP Configuration
        echo GMAIL_CLIENT_ID="your_gmail_client_id_here"
        echo GMAIL_CLIENT_SECRET="your_gmail_client_secret_here"
        echo GMAIL_PUBSUB_TOPIC="projects/your-project/topics/gmail-notifications"
        echo GMAIL_WEBHOOK_SECRET="your-webhook-secret-here"
        echo.
        echo # Frontend Configuration
        echo FRONTEND_URL="http://localhost:3000"
    ) > .env
    echo ✅ Created .env template. Please fill in your Gmail credentials.
) else (
    echo ✅ .env file exists
)
echo.

REM Run database migrations
echo 🗄️ Setting up database...
cd ..\..
cd packages\db
npx prisma migrate dev --name gmail_integration_test

if %errorlevel% neq 0 (
    echo ❌ Database migration failed
    pause
    exit /b 1
)

npx prisma generate

if %errorlevel% neq 0 (
    echo ❌ Prisma client generation failed
    pause
    exit /b 1
)

echo ✅ Database setup complete
echo.

REM Go back to server directory
cd ..\server

REM Check if test script exists
if exist src\test-gmail-integration.ts (
    echo ✅ Test script found
) else (
    echo ❌ Test script not found
    pause
    exit /b 1
)

echo.
echo 🎉 Setup Complete!
echo ==================
echo.
echo To run the Gmail integration tests:
echo   cd apps\server
echo   npm run test:gmail
echo.
echo To start the development server:
echo   npm run dev
echo.
echo To run the frontend:
echo   cd ../web
echo   npm run dev
echo.
echo 📝 Next Steps:
echo 1. Configure your Gmail OAuth credentials in .env
echo 2. Set up Google Cloud Pub/Sub (optional)
echo 3. Run the test script: npm run test:gmail
echo 4. Test the UI at http://localhost:3000/gmail
echo.
echo 📚 For detailed testing instructions, see GMAIL_INTEGRATION_TESTING.md
echo.
pause
