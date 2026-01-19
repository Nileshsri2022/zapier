import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware factory to validate request body against a Zod schema.
 * Returns 422 with detailed errors if validation fails.
 */
export const validateBody = <T extends z.ZodSchema>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(422).json({
        message: 'Validation failed',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    // Replace body with parsed/validated data
    req.body = result.data;
    next();
  };
};

/**
 * Middleware factory to validate request params against a Zod schema.
 */
export const validateParams = <T extends z.ZodSchema>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      res.status(400).json({
        message: 'Invalid parameters',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    req.params = result.data as typeof req.params;
    next();
  };
};

/**
 * Middleware factory to validate request query against a Zod schema.
 */
export const validateQuery = <T extends z.ZodSchema>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        message: 'Invalid query parameters',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    // Type assertion needed for query object
    req.query = result.data as typeof req.query;
    next();
  };
};
