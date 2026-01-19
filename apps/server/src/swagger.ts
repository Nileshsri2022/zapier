import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ZapMate API',
      version: '1.0.0',
      description: 'API documentation for ZapMate - A Zapier-like automation platform',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'API Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            code: { type: 'string' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
          },
        },
        Zap: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            isActive: { type: 'boolean' },
            createdDate: { type: 'string', format: 'date-time' },
            userId: { type: 'integer' },
          },
        },
        Trigger: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string' },
            image: { type: 'string', format: 'uri' },
          },
        },
        Action: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string' },
            image: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Zaps', description: 'Zap management' },
      { name: 'Triggers', description: 'Available triggers' },
      { name: 'Actions', description: 'Available actions' },
      { name: 'Gmail', description: 'Gmail integration' },
      { name: 'Google Sheets', description: 'Google Sheets integration' },
      { name: 'Google Calendar', description: 'Google Calendar integration' },
      { name: 'Telegram', description: 'Telegram bot integration' },
      { name: 'WhatsApp', description: 'WhatsApp integration' },
      { name: 'GitHub', description: 'GitHub webhooks' },
      { name: 'Schedule', description: 'Scheduled triggers' },
    ],
  },
  apis: ['./src/routes/*.ts', './src/swagger-docs.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
