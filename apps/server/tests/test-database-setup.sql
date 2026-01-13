-- Test Database Setup for ZapMate Authentication Tests
-- Run this script to set up a test database for running authentication tests

-- Create test database
CREATE DATABASE zapmate_test;

-- Create test user
CREATE USER zapmate_test_user WITH PASSWORD 'test_password_123';
GRANT ALL PRIVILEGES ON DATABASE zapmate_test TO zapmate_test_user;

-- Connect to test database
\c zapmate_test;

-- Create test tables (simplified for testing)
CREATE TABLE IF NOT EXISTS "User" (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test data
INSERT INTO "User" (name, email, password) VALUES
    ('Test User', 'test@example.com', '$2b$10$hashedpassword123'),
    ('Existing User', 'existing@example.com', '$2b$10$hashedpassword456')
ON CONFLICT (email) DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON TABLE "User" TO zapmate_test_user;
GRANT USAGE, SELECT ON SEQUENCE "User_id_seq" TO zapmate_test_user;

-- Test connection
SELECT 'Test database setup completed successfully!' as status;
