import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

// Create logger with pretty printing in dev, JSON in production
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: process.env.SERVICE_NAME || 'unknown',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Create child logger for specific components
export const createLogger = (component: string) => {
  return logger.child({ component });
};

// Request logging middleware
export const requestLogger = (serviceName: string) => {
  const log = createLogger(serviceName);

  return (req: any, res: any, next: any) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      log.info(
        {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration: `${duration}ms`,
          userAgent: req.headers['user-agent'],
        },
        `${req.method} ${req.url}`
      );
    });

    next();
  };
};

// Error logging helper
export const logError = (error: Error, context?: Record<string, any>) => {
  logger.error(
    {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      ...context,
    },
    error.message
  );
};

export default logger;
