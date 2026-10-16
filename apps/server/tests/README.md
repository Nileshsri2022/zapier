# Authentication Tests

This directory contains comprehensive tests for the ZapMate authentication system, including signup, signin, and error handling scenarios.

## 🧪 Test Structure

```
tests/
├── auth/
│   ├── signup.test.ts          # Signup functionality tests
│   ├── signin.test.ts          # Signin functionality tests
│   └── error-handling.test.ts  # Error handling and edge cases
├── setup.ts                    # Test configuration and mocks
├── utils.ts                    # Test utilities and helpers
├── test-database-setup.sql     # Database setup for testing
└── README.md                   # This file
```

## 🚀 Running Tests

### Prerequisites

1. **Install dependencies**:

   ```bash
   cd apps/server
   npm install
   ```

2. **Set up test database**:

   ```bash
   # Run the SQL setup script
   psql -U postgres -f tests/test-database-setup.sql
   ```

3. **Environment variables**:
   The tests use the following environment variables (set in `tests/setup.ts`):
   - `JWT_SECRET`: Test JWT secret
   - `NODE_ENV`: Set to 'test'

### Running All Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Running Specific Test Suites

```bash
# Run only authentication tests
npm run test:auth

# Run only signup tests
npm run test:signup

# Run only signin tests
npm run test:signin
```

## 📋 Test Coverage

### Signup Tests (`signup.test.ts`)

#### ✅ Successful Signup

- [x] Create new user with valid data
- [x] Hash password before storing
- [x] Send welcome email after signup

#### ✅ Validation Errors

- [x] Invalid email format
- [x] Name too short
- [x] Password too short
- [x] Missing required fields

#### ✅ Duplicate User Errors

- [x] User already exists

#### ✅ Database Errors

- [x] Database create failure

#### ✅ Edge Cases

- [x] Empty request body
- [x] Null values in request
- [x] Extremely long input values

### Signin Tests (`signin.test.ts`)

#### ✅ Successful Signin

- [x] Sign in with correct credentials
- [x] Generate JWT token with correct payload

#### ✅ Validation Errors

- [x] Invalid email format
- [x] Password too short
- [x] Missing required fields

#### ✅ Authentication Errors

- [x] User does not exist
- [x] Incorrect password
- [x] bcrypt comparison errors

#### ✅ JWT Token Generation

- [x] JWT signing errors
- [x] Correct JWT secret usage

#### ✅ Edge Cases

- [x] Empty request body
- [x] Null values in request
- [x] Case-sensitive email matching
- [x] Database query errors

### Error Handling Tests (`error-handling.test.ts`)

#### ✅ General Error Handling

- [x] Malformed JSON in request body
- [x] Unsupported HTTP methods
- [x] Non-existent endpoints

#### ✅ Input Sanitization

- [x] HTML/script injection attempts
- [x] SQL injection attempts
- [x] Extremely large payloads

#### ✅ Rate Limiting Simulation

- [x] Rapid consecutive requests

#### ✅ Network and Timeout Handling

- [x] Slow requests handling

#### ✅ Authentication Middleware

- [x] Missing authorization header
- [x] Invalid authorization header
- [x] Malformed JWT token
- [x] Expired JWT token

#### ✅ Database Connection Issues

- [x] Database connection failures

#### ✅ Environment and Configuration Issues

- [x] Missing JWT secret

## 🛠️ Test Configuration

### Jest Configuration (`jest.config.js`)

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  moduleNameMapping: {
    '^@repo/(.*)$': '<rootDir>/../packages/$1/src',
  },
};
```

### Test Setup (`tests/setup.ts`)

- Mocks environment variables
- Mocks email service to avoid sending actual emails
- Mocks database client for isolated testing
- Sets global test timeout
- Cleans up mocks after each test

### Test Utilities (`tests/utils.ts`)

- `createTestApp()`: Creates Express app for testing
- Test user data constants
- Mock user objects
- Helper functions for authenticated requests

## 🗄️ Database Setup

### Test Database Configuration

The tests use a separate test database to avoid affecting production data:

```sql
-- Database: zapmate_test
-- User: zapmate_test_user
-- Password: test_password_123
```

### Running Database Setup

```bash
# Connect to PostgreSQL as superuser
psql -U postgres

# Run the setup script
\i tests/test-database-setup.sql
```

### Test Data

The test database includes:

- Test users for authentication testing
- Proper table structure matching the Prisma schema
- Indexes and constraints for realistic testing

## 🔧 Mocking Strategy

### Database Mocking

- All database operations are mocked using Jest
- No actual database calls are made during tests
- Mock responses simulate real database behavior

### Email Service Mocking

- Email sending is mocked to avoid actual email delivery
- Mock verifies correct email parameters are passed

### JWT Mocking

- JWT token generation is mocked for consistent testing
- Mock allows verification of token payload and options

## 📊 Coverage Reports

### Generating Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# View coverage in browser
open coverage/lcov-report/index.html
```

### Coverage Goals

- **Statements**: 90%+
- **Branches**: 85%+
- **Functions**: 95%+
- **Lines**: 90%+

## 🐛 Debugging Tests

### Running Tests in Debug Mode

```bash
# Run specific test file with debug output
npx jest tests/auth/signup.test.ts --verbose

# Run with detailed error reporting
npx jest --verbose --no-cache
```

### Common Issues

1. **Database Connection Errors**
   - Ensure test database is set up correctly
   - Check database credentials in environment

2. **Mock Issues**
   - Verify mocks are properly reset between tests
   - Check that all required functions are mocked

3. **TypeScript Errors**
   - Ensure all test files have proper type annotations
   - Check Jest configuration for TypeScript support

## 🤝 Contributing

### Adding New Tests

1. Create test file in appropriate directory
2. Follow existing naming conventions (`*.test.ts`)
3. Include comprehensive test cases
4. Add proper documentation
5. Update this README if needed

### Test Best Practices

- **Arrange-Act-Assert**: Structure tests clearly
- **Descriptive Names**: Use descriptive test names
- **Independent Tests**: Tests should not depend on each other
- **Proper Mocking**: Mock external dependencies
- **Edge Cases**: Test boundary conditions and error cases
- **Documentation**: Document complex test scenarios

## 📚 Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Testing Express Applications](https://expressjs.com/en/advanced/best-practice-performance.html)
- [Node.js Testing Best Practices](https://github.com/goldbergyoni/nodebestpractices#6-testing-guidelines)

---

**Happy Testing! 🧪**
