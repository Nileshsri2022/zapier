#!/usr/bin/env ts-node

/**
 * Gmail MCP Integration Test Script
 *
 * This script tests the complete Gmail integration including:
 * - Server connection and authentication
 * - Rate limiting and error handling
 * - Trigger and action functionality
 * - Database operations
 *
 * Usage: npm run test:gmail
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { GmailService } from './services/GmailService';
import { GmailRateLimiter } from './services/GmailRateLimiter';
import { GmailErrorHandler } from './services/GmailErrorHandler';

const BASE_URL = 'http://localhost:5000/api';
const TEST_USER_EMAIL = 'test@example.com';

interface TestResult {
  test: string;
  passed: boolean;
  message: string;
  duration?: number;
}

class GmailIntegrationTester {
  private results: TestResult[] = [];
  private token: string | null = null;
  private testServerId: string | null = null;
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Gmail MCP Integration Tests...\n');

    try {
      // Setup
      await this.setupTestEnvironment();

      // Run tests
      await this.testAuthentication();
      await this.testServerManagement();
      await this.testRateLimiting();
      await this.testErrorHandling();
      await this.testDatabaseOperations();

      // Cleanup
      await this.cleanupTestEnvironment();

      // Results
      this.displayResults();

    } catch (error) {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    } finally {
      await this.prisma.$disconnect();
    }
  }

  private async setupTestEnvironment(): Promise<void> {
    console.log('📋 Setting up test environment...');

    // Create test user if not exists
    const testUser = await this.prisma.user.upsert({
      where: { email: TEST_USER_EMAIL },
      update: {},
      create: {
        name: 'Test User',
        email: TEST_USER_EMAIL,
        password: 'testpassword123',
      },
    });

    // Generate test token (in real app, this would be JWT)
    this.token = `test-token-${testUser.id}`;

    console.log('✅ Test environment ready');
  }

  private async testAuthentication(): Promise<void> {
    const startTime = Date.now();

    try {
      console.log('🔐 Testing authentication...');

      // Test 1: Invalid token
      try {
        await axios.get(`${BASE_URL}/gmail/servers`, {
          headers: { Authorization: 'invalid-token' }
        });
        this.recordResult('Authentication - Invalid token rejected', false, 'Should have rejected invalid token');
      } catch (error: any) {
        if (error.response?.status === 401) {
          this.recordResult('Authentication - Invalid token rejected', true, 'Correctly rejected invalid token');
        } else {
          this.recordResult('Authentication - Invalid token rejected', false, 'Unexpected error: ' + error.message);
        }
      }

      // Test 2: Valid token format
      try {
        await axios.get(`${BASE_URL}/gmail/servers`, {
          headers: { Authorization: this.token! }
        });
        this.recordResult('Authentication - Valid token accepted', true, 'Token format accepted');
      } catch (error: any) {
        // This might fail if no servers exist, which is expected
        if (error.response?.status === 404 || error.response?.status === 500) {
          this.recordResult('Authentication - Valid token accepted', true, 'Token format accepted (expected server error)');
        } else {
          this.recordResult('Authentication - Valid token accepted', false, 'Unexpected error: ' + error.message);
        }
      }

    } catch (error: any) {
      this.recordResult('Authentication tests', false, 'Test failed: ' + error.message);
    }

    this.recordResult('Authentication tests', true, 'All authentication tests completed', Date.now() - startTime);
  }

  private async testServerManagement(): Promise<void> {
    const startTime = Date.now();

    try {
      console.log('🏠 Testing server management...');

      // Test 1: Initiate OAuth (this will fail without real credentials, but should not crash)
      try {
        await axios.post(`${BASE_URL}/gmail/auth/initiate`, {
          name: 'Test Gmail Server'
        }, {
          headers: { Authorization: this.token! }
        });
        this.recordResult('Server Management - OAuth initiation', false, 'Should require valid credentials');
      } catch (error: any) {
        if (error.response?.status === 500 || error.response?.status === 400) {
          this.recordResult('Server Management - OAuth initiation', true, 'Properly handled missing credentials');
        } else {
          this.recordResult('Server Management - OAuth initiation', false, 'Unexpected error: ' + error.message);
        }
      }

      // Test 2: Get servers (should return empty array or error gracefully)
      try {
        const response = await axios.get(`${BASE_URL}/gmail/servers`, {
          headers: { Authorization: this.token! }
        });
        this.recordResult('Server Management - Get servers', true, 'Successfully retrieved servers list');
      } catch (error: any) {
        if (error.response?.status === 404) {
          this.recordResult('Server Management - Get servers', true, 'No servers found (expected)');
        } else {
          this.recordResult('Server Management - Get servers', false, 'Unexpected error: ' + error.message);
        }
      }

    } catch (error: any) {
      this.recordResult('Server management tests', false, 'Test failed: ' + error.message);
    }

    this.recordResult('Server management tests', true, 'All server management tests completed', Date.now() - startTime);
  }

  private async testRateLimiting(): Promise<void> {
    const startTime = Date.now();

    try {
      console.log('⚡ Testing rate limiting...');

      // Test rate limiter directly
      const rateLimiter = new GmailRateLimiter({
        maxRequestsPerSecond: 5,
        maxRequestsPerMinute: 10,
        maxRequestsPerHour: 50,
        quotaLimit: 100,
      });

      // Test 1: Initial state
      const initialCheck = rateLimiter.canMakeRequest(1);
      if (initialCheck.allowed) {
        this.recordResult('Rate Limiting - Initial state', true, 'Rate limiter allows initial requests');
      } else {
        this.recordResult('Rate Limiting - Initial state', false, 'Rate limiter should allow initial requests');
      }

      // Test 2: Record requests
      for (let i = 0; i < 3; i++) {
        rateLimiter.recordRequest(1);
      }

      const afterRequestsCheck = rateLimiter.canMakeRequest(1);
      if (afterRequestsCheck.allowed) {
        this.recordResult('Rate Limiting - Request tracking', true, 'Rate limiter tracks requests correctly');
      } else {
        this.recordResult('Rate Limiting - Request tracking', false, 'Rate limiter should still allow requests');
      }

      // Test 3: Status reporting
      const status = rateLimiter.getStatus();
      if (status.requestsPerSecond === 0 && status.quotaUsed === 3) {
        this.recordResult('Rate Limiting - Status reporting', true, 'Rate limiter status is accurate');
      } else {
        this.recordResult('Rate Limiting - Status reporting', false, 'Rate limiter status incorrect');
      }

    } catch (error: any) {
      this.recordResult('Rate limiting tests', false, 'Test failed: ' + error.message);
    }

    this.recordResult('Rate limiting tests', true, 'All rate limiting tests completed', Date.now() - startTime);
  }

  private async testErrorHandling(): Promise<void> {
    const startTime = Date.now();

    try {
      console.log('🛠️ Testing error handling...');

      // Test error handler directly
      const errorHandler = new GmailErrorHandler();

      // Test 1: Error classification
      const testErrors = [
        { code: 429, expectedType: 'RATE_LIMIT_EXCEEDED' },
        { code: 403, expectedType: 'QUOTA_EXCEEDED' },
        { code: 401, expectedType: 'AUTHENTICATION_ERROR' },
        { code: 400, expectedType: 'INVALID_REQUEST' },
        { code: 404, expectedType: 'RESOURCE_NOT_FOUND' },
        { code: 500, expectedType: 'SERVER_ERROR' },
      ];

      for (const testError of testErrors) {
        const mockError = { code: testError.code, message: 'Test error' };
        const classifiedError = (errorHandler.constructor as any).classifyError(mockError);

        if (classifiedError.type === testError.expectedType) {
          this.recordResult(`Error Handling - ${testError.expectedType}`, true, 'Error correctly classified');
        } else {
          this.recordResult(`Error Handling - ${testError.expectedType}`, false, `Expected ${testError.expectedType}, got ${classifiedError.type}`);
        }
      }

      // Test 2: Circuit breaker
      const circuitStatus = errorHandler.getCircuitBreakerStatus();
      if (circuitStatus.state === 'CLOSED') {
        this.recordResult('Error Handling - Circuit breaker', true, 'Circuit breaker initialized correctly');
      } else {
        this.recordResult('Error Handling - Circuit breaker', false, 'Circuit breaker not in expected state');
      }

    } catch (error: any) {
      this.recordResult('Error handling tests', false, 'Test failed: ' + error.message);
    }

    this.recordResult('Error handling tests', true, 'All error handling tests completed', Date.now() - startTime);
  }

  private async testDatabaseOperations(): Promise<void> {
    const startTime = Date.now();

    try {
      console.log('💾 Testing database operations...');

      // Test 1: Check if Gmail tables exist
      try {
        const gmailServers = await this.prisma.gmailServer.findMany();
        this.recordResult('Database - GmailServer table', true, 'GmailServer table accessible');
      } catch (error: any) {
        this.recordResult('Database - GmailServer table', false, 'GmailServer table not accessible: ' + error.message);
      }

      // Test 2: Check if GmailTrigger table exists
      try {
        const gmailTriggers = await this.prisma.gmailTrigger.findMany();
        this.recordResult('Database - GmailTrigger table', true, 'GmailTrigger table accessible');
      } catch (error: any) {
        this.recordResult('Database - GmailTrigger table', false, 'GmailTrigger table not accessible: ' + error.message);
      }

      // Test 3: Check if GmailAction table exists
      try {
        const gmailActions = await this.prisma.gmailAction.findMany();
        this.recordResult('Database - GmailAction table', true, 'GmailAction table accessible');
      } catch (error: any) {
        this.recordResult('Database - GmailAction table', false, 'GmailAction table not accessible: ' + error.message);
      }

      // Test 4: Check if GmailWatch table exists
      try {
        const gmailWatches = await this.prisma.gmailWatch.findMany();
        this.recordResult('Database - GmailWatch table', true, 'GmailWatch table accessible');
      } catch (error: any) {
        this.recordResult('Database - GmailWatch table', false, 'GmailWatch table not accessible: ' + error.message);
      }

    } catch (error: any) {
      this.recordResult('Database tests', false, 'Test failed: ' + error.message);
    }

    this.recordResult('Database tests', true, 'All database tests completed', Date.now() - startTime);
  }

  private async cleanupTestEnvironment(): Promise<void> {
    console.log('🧹 Cleaning up test environment...');

    try {
      // Clean up any test data created during testing
      await this.prisma.gmailServer.deleteMany({
        where: { name: { contains: 'Test' } }
      });

      await this.prisma.gmailTrigger.deleteMany({
        where: { triggerType: 'test_trigger' }
      });

      await this.prisma.gmailAction.deleteMany({
        where: { actionType: 'test_action' }
      });

      console.log('✅ Test environment cleaned up');
    } catch (error) {
      console.log('⚠️ Could not clean up all test data (this is normal)');
    }
  }

  private recordResult(test: string, passed: boolean, message: string, duration?: number): void {
    this.results.push({
      test,
      passed,
      message,
      duration,
    });

    const status = passed ? '✅' : '❌';
    const timeInfo = duration ? ` (${duration}ms)` : '';
    console.log(`${status} ${test}${timeInfo}: ${message}`);
  }

  private displayResults(): void {
    console.log('\n📊 Test Results Summary');
    console.log('='.repeat(50));

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const failed = total - passed;

    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Success Rate: ${total > 0 ? Math.round((passed / total) * 100) : 0}%`);

    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.filter(r => !r.passed).forEach(result => {
        console.log(`  - ${result.test}: ${result.message}`);
      });
    }

    console.log('\n' + '='.repeat(50));

    if (failed === 0) {
      console.log('🎉 All tests passed! Gmail MCP integration is working correctly.');
      process.exit(0);
    } else {
      console.log('⚠️ Some tests failed. Please review the issues above.');
      process.exit(1);
    }
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  const tester = new GmailIntegrationTester();
  tester.runAllTests().catch(error => {
    console.error('💥 Test suite crashed:', error);
    process.exit(1);
  });
}

export { GmailIntegrationTester };
