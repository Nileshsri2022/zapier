# Gmail MCP Integration Testing Guide

## Overview

This comprehensive testing guide covers the complete Gmail MCP integration for ZapMate. The integration includes Gmail server management, OAuth authentication, email triggers, email actions, rate limiting, and error handling.

## Prerequisites

### Environment Setup
1. **Install Dependencies**:
   ```bash
   cd apps/server
   npm install googleapis @google-cloud/local-auth
   ```

2. **Environment Variables** (in `.env`):
   ```env
   GMAIL_CLIENT_ID="your_gmail_client_id_here"
   GMAIL_CLIENT_SECRET="your_gmail_client_secret_here"
   GMAIL_PUBSUB_TOPIC="projects/your-project/topics/gmail-notifications"
   GMAIL_WEBHOOK_SECRET="your-webhook-secret-here"
   FRONTEND_URL="http://localhost:3000"
   ```

3. **Google Cloud Setup**:
   - Enable Gmail API in Google Cloud Console
   - Create OAuth 2.0 credentials
   - Set up Pub/Sub topic (optional, for push notifications)

### Database Setup
1. **Run Migrations**:
   ```bash
   cd packages/db
   npx prisma migrate dev --name gmail_integration
   npx prisma generate
   ```

2. **Seed Database** (optional):
   ```bash
   cd apps/server
   npm run seed
   ```

## Testing Components

### 1. Backend API Testing

#### Gmail Server Management Endpoints

**Test 1: Initiate Gmail OAuth**
```bash
curl -X POST http://localhost:5000/api/gmail/auth/initiate \
  -H "Content-Type: application/json" \
  -H "Authorization: YOUR_TOKEN_HERE" \
  -d '{"name": "Test Gmail Server"}'
```

**Expected Response**:
```json
{
  "message": "Gmail OAuth initiated",
  "authUrl": "https://accounts.google.com/oauth/authorize?..."
}
```

**Test 2: Get Gmail Servers**
```bash
curl -X GET http://localhost:5000/api/gmail/servers \
  -H "Authorization: YOUR_TOKEN_HERE"
```

**Expected Response**:
```json
{
  "message": "Gmail servers retrieved successfully",
  "gmailServers": [
    {
      "id": "server-uuid",
      "name": "Test Gmail Server",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "gmailTriggers": [],
      "gmailActions": [],
      "watchHistory": []
    }
  ]
}
```

**Test 3: Test Gmail Connection**
```bash
curl -X POST http://localhost:5000/api/gmail/servers/SERVER_ID/test \
  -H "Authorization: YOUR_TOKEN_HERE"
```

**Expected Response**:
```json
{
  "message": "Gmail connection successful",
  "email": "user@gmail.com"
}
```

#### Gmail Trigger Endpoints

**Test 4: Create Gmail Trigger**
```bash
curl -X POST http://localhost:5000/api/gmail/triggers \
  -H "Content-Type: application/json" \
  -H "Authorization: YOUR_TOKEN_HERE" \
  -d '{
    "serverId": "SERVER_ID",
    "zapId": "ZAP_ID",
    "triggerType": "new_email",
    "watchedLabels": ["INBOX"],
    "senderFilter": "boss@company.com",
    "subjectFilter": "urgent"
  }'
```

**Expected Response**:
```json
{
  "message": "Gmail trigger created successfully",
  "gmailTrigger": {
    "id": "trigger-uuid",
    "triggerType": "new_email",
    "watchedLabels": ["INBOX"],
    "senderFilter": "boss@company.com",
    "subjectFilter": "urgent"
  }
}
```

#### Gmail Action Endpoints

**Test 5: Gmail Actions (Note: Requires proper API implementation)**
```bash
# This would test Gmail action creation
curl -X POST http://localhost:5000/api/gmail/actions \
  -H "Content-Type: application/json" \
  -H "Authorization: YOUR_TOKEN_HERE" \
  -d '{
    "serverId": "SERVER_ID",
    "actionType": "GmailSend",
    "metadata": {
      "to": "recipient@example.com",
      "subject": "Test Email",
      "body": "This is a test email from ZapMate"
    }
  }'
```

#### Rate Limiting & Monitoring Endpoints

**Test 6: Check Rate Limit Status**
```bash
curl -X GET http://localhost:5000/api/gmail/servers/SERVER_ID/ratelimit \
  -H "Authorization: YOUR_TOKEN_HERE"
```

**Expected Response**:
```json
{
  "message": "Gmail rate limit status retrieved successfully",
  "rateLimitStatus": {
    "requestsPerSecond": 0,
    "requestsPerMinute": 0,
    "requestsPerHour": 0,
    "quotaUsed": 0,
    "quotaRemaining": 250
  },
  "circuitBreakerStatus": {
    "state": "CLOSED",
    "failureCount": 0,
    "lastFailureTime": 0,
    "timeout": 60000
  }
}
```

**Test 7: Reset Circuit Breaker**
```bash
curl -X POST http://localhost:5000/api/gmail/servers/SERVER_ID/reset-circuit \
  -H "Authorization: YOUR_TOKEN_HERE"
```

**Expected Response**:
```json
{
  "message": "Gmail circuit breaker reset successfully"
}
```

### 2. Frontend UI Testing

#### Gmail Dashboard Access
1. **Navigate to Gmail Dashboard**:
   - Go to `http://localhost:3000/dashboard`
   - Click the "Gmail" button in the top right

2. **Test Gmail Server Configuration**:
   - Click "Add Gmail Server"
   - Enter server name
   - Verify OAuth redirect works
   - Complete Gmail authorization
   - Verify server appears in list

3. **Test Gmail Trigger Configuration**:
   - Select a Gmail server
   - Click "Add Trigger"
   - Select trigger type (e.g., "New Email")
   - Configure filters (labels, sender, subject)
   - Enter Zap ID
   - Create trigger
   - Verify trigger appears in list

4. **Test Gmail Action Configuration**:
   - Select a Gmail server
   - Click "Add Action"
   - Select action type (e.g., "Send Email")
   - Fill in required fields
   - Create action
   - Verify action appears in list

5. **Test Status Monitor**:
   - Select a Gmail server
   - View rate limit status
   - View circuit breaker status
   - Monitor quota usage
   - Test circuit breaker reset

### 3. Integration Testing

#### End-to-End Email Automation Test

**Test Scenario**: New email from specific sender triggers notification

1. **Setup**:
   - Create Gmail server connection
   - Create a Zap with Gmail trigger and email action
   - Configure trigger to watch for emails from test sender
   - Configure action to send notification email

2. **Execute Test**:
   - Send test email from configured sender
   - Verify trigger fires
   - Verify notification email is sent
   - Check logs for successful execution

3. **Verify Results**:
   - Check Gmail trigger logs
   - Verify email action executed
   - Confirm rate limiting worked correctly
   - Verify error handling if any issues occurred

#### Rate Limiting Stress Test

1. **Setup**:
   - Configure Gmail server
   - Create multiple email actions

2. **Execute Test**:
   - Trigger multiple rapid email operations
   - Monitor rate limit status
   - Verify requests are properly throttled
   - Check circuit breaker activation if needed

3. **Verify Results**:
   - Rate limits respected
   - No quota exceeded errors
   - Circuit breaker functions correctly
   - System remains stable under load

### 4. Error Handling Testing

#### Authentication Error Test
1. **Setup**: Use invalid or expired Gmail credentials
2. **Execute**: Attempt to connect Gmail server
3. **Expected**: Proper error message, no system crash
4. **Verify**: Error logged, user notified, system recovers

#### Rate Limit Error Test
1. **Setup**: Configure low rate limits for testing
2. **Execute**: Exceed rate limits rapidly
3. **Expected**: Requests throttled, no API errors
4. **Verify**: Rate limiter working, circuit breaker may activate

#### Network Error Test
1. **Setup**: Gmail server with intermittent connectivity
2. **Execute**: Trigger email operations during network issues
3. **Expected**: Retry logic activated, graceful degradation
4. **Verify**: Exponential backoff working, errors handled properly

## Testing Tools & Utilities

### API Testing with Postman/curl

Create a Postman collection with the following requests:

1. **Gmail Auth Initiate**
   - Method: POST
   - URL: `http://localhost:5000/api/gmail/auth/initiate`
   - Body: `{"name": "Test Server"}`

2. **Get Gmail Servers**
   - Method: GET
   - URL: `http://localhost:5000/api/gmail/servers`

3. **Test Connection**
   - Method: POST
   - URL: `http://localhost:5000/api/gmail/servers/{serverId}/test`

4. **Create Trigger**
   - Method: POST
   - URL: `http://localhost:5000/api/gmail/triggers`
   - Body: `{"serverId": "...", "zapId": "...", "triggerType": "new_email"}`

### Browser Developer Tools

1. **Network Tab**: Monitor API calls
2. **Console**: Check for JavaScript errors
3. **Application Tab**: Verify localStorage token storage
4. **Performance Tab**: Monitor page load times

### Database Verification

1. **Check Gmail Servers**:
   ```sql
   SELECT * FROM "GmailServer";
   ```

2. **Check Gmail Triggers**:
   ```sql
   SELECT * FROM "GmailTrigger";
   ```

3. **Check Gmail Actions**:
   ```sql
   SELECT * FROM "GmailAction";
   ```

4. **Check Gmail Watch History**:
   ```sql
   SELECT * FROM "GmailWatch";
   ```

## Troubleshooting Guide

### Common Issues & Solutions

#### 1. OAuth Authentication Fails
**Symptoms**: OAuth redirect fails or returns error
**Solutions**:
- Verify `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`
- Check `FRONTEND_URL` configuration
- Ensure Gmail API is enabled in Google Cloud Console
- Verify OAuth redirect URIs are configured correctly

#### 2. Rate Limiting Issues
**Symptoms**: Requests being throttled unexpectedly
**Solutions**:
- Check rate limit configuration in GmailRateLimiter
- Monitor quota usage via status endpoint
- Adjust rate limits for testing environment
- Verify circuit breaker is not stuck in OPEN state

#### 3. Database Connection Errors
**Symptoms**: Prisma errors when accessing Gmail tables
**Solutions**:
- Run database migrations
- Regenerate Prisma client
- Check database connection string
- Verify user permissions

#### 4. Webhook/Push Notification Issues
**Symptoms**: Real-time notifications not working
**Solutions**:
- Verify `GMAIL_PUBSUB_TOPIC` configuration
- Check webhook endpoint accessibility
- Ensure proper webhook signature verification
- Monitor webhook delivery in Google Cloud Console

#### 5. Frontend Issues
**Symptoms**: UI components not loading or functioning
**Solutions**:
- Check browser console for JavaScript errors
- Verify API endpoints are accessible
- Check authentication token storage
- Ensure all dependencies are installed

### Debug Mode

Enable debug logging by setting environment variables:

```env
DEBUG=gmail:*
LOG_LEVEL=debug
```

### Performance Monitoring

Monitor system performance using the built-in endpoints:

```bash
# Check rate limits
curl http://localhost:5000/api/gmail/servers/{id}/ratelimit

# Monitor circuit breaker
curl http://localhost:5000/api/gmail/servers/{id}/ratelimit

# View server logs
tail -f apps/server/logs/gmail.log
```

## Security Testing

### Authentication Security
- Verify OAuth tokens are properly encrypted in database
- Test token refresh mechanism
- Ensure webhook signatures are validated
- Check for proper CORS configuration

### Authorization Security
- Verify users can only access their own Gmail servers
- Test API endpoint authorization
- Ensure proper input validation
- Check for SQL injection vulnerabilities

### Data Security
- Verify sensitive data encryption
- Test data isolation between users
- Ensure proper error message sanitization
- Check for information disclosure in logs

## Performance Testing

### Load Testing
1. **Setup**: Create multiple Gmail servers and triggers
2. **Execute**: Simulate high-volume email operations
3. **Monitor**: Rate limiting, quota usage, response times
4. **Verify**: System stability under load

### Stress Testing
1. **Setup**: Configure aggressive rate limits
2. **Execute**: Exceed limits intentionally
3. **Monitor**: Circuit breaker activation, error handling
4. **Verify**: System recovery and graceful degradation

## Success Criteria

### Functional Requirements
- ✅ Gmail OAuth authentication works
- ✅ Gmail servers can be created and managed
- ✅ Email triggers fire correctly
- ✅ Email actions execute properly
- ✅ Rate limiting prevents quota issues
- ✅ Error handling works as expected

### Performance Requirements
- ✅ Response times under 2 seconds for normal operations
- ✅ Rate limiting prevents API quota exhaustion
- ✅ Circuit breaker prevents cascade failures
- ✅ System remains stable under moderate load

### Security Requirements
- ✅ OAuth tokens properly encrypted
- ✅ Users can only access their own data
- ✅ Webhook signatures validated
- ✅ No sensitive data exposed in errors

### Usability Requirements
- ✅ UI is intuitive and responsive
- ✅ Error messages are clear and helpful
- ✅ Setup process is straightforward
- ✅ Status monitoring provides useful information

## Conclusion

This testing guide provides comprehensive coverage of the Gmail MCP integration. Following these procedures will ensure the system is robust, secure, and ready for production use.

For additional support or questions, refer to the implementation documentation or contact the development team.
