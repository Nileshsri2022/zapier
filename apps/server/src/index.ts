import express, { Express } from 'express';
import router from './routes';
import cors from 'cors';
import dotenv from 'dotenv';
import client from '@repo/db';
import { initSentry, captureException, sentryErrorHandler } from '@repo/sentry';
import {
  apiLimiter,
  sanitizeInput,
  apiSecurityHeaders,
  compressionMiddleware,
} from './middlewares';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';

// Load environment variables first
dotenv.config();

// Initialize Sentry early (before other imports that might throw)
initSentry({ serviceName: 'server' });

// Import env validation (will exit if validation fails)
import { env } from './env';

const app: Express = express();
const PORT = env.PORT || 5000;

// CORS configuration - allow all origins (auth is handled by JWT)
const corsOptions = {
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
};

app.use(express.json());
app.use(cors(corsOptions));
app.use(compressionMiddleware); // Compress API responses

// Security middleware
app.use(apiSecurityHeaders); // Set secure HTTP headers
app.use(sanitizeInput); // Sanitize all inputs against XSS
app.use('/api', apiLimiter); // Rate limit API endpoints

// API Documentation
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'ZapMate API Docs',
  })
);

// Health check endpoint for Render
app.get('/health', async (req, res) => {
  try {
    // Verify database connection
    await client.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

// Handling all the routes
app.use('/api', router);

app.get('/', (req, res) => {
  res.send('Server is working!');
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}!`);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  console.log(`\n📛 Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    console.log('✅ HTTP server closed');

    try {
      await client.$disconnect();
      console.log('✅ Database connection closed');
    } catch (error) {
      console.error('❌ Error closing database connection:', error);
    }

    console.log('👋 Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  captureException(error);
  process.exit(1);
});
