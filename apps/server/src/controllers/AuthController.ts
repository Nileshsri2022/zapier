import { Request, Response } from 'express';
import { SigninSchema, SignupSchema } from '@repo/types';
import { formatZodError } from '../helper';
import client from '@repo/db';
import { sendEmail } from '@repo/email';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

export const signup = async (req: Request, res: Response): Promise<any> => {
  const body = req.body;

  const validation = SignupSchema.safeParse(body);
  if (validation.error) {
    return res.status(422).json({
      message: 'Invalid credentials',
      error: formatZodError(validation.error),
    });
  }

  const user = await client.user.findUnique({
    where: {
      email: validation?.data?.email,
    },
  });

  if (user) {
    return res.status(404).json({
      message: 'Invalid request',
      error: {
        email: 'User with this email already exists',
      },
    });
  }

  const pwHash = bcrypt.hashSync(validation?.data?.password, 10);

  const newUser = await client.user.create({
    data: {
      name: validation?.data?.name,
      email: validation?.data?.email,
      password: pwHash,
    },
  });

  if (!newUser) {
    return res.status(500).json({
      message: 'Something went wrong!',
      error: {
        message: 'Internal server error, please try again later',
      },
    });
  }

  const emailSubject = 'Welcome to ZapMate! Let’s Get Automating!';
  try {
    await sendEmail(validation?.data?.email, emailSubject, 'signup-confirmation.html');
  } catch (emailError) {
    console.error('Failed to send welcome email:', emailError);
    // Continue anyway - user is already created
  }

  return res.status(201).json({
    message: 'Signup successful',
    data: {
      // Never serialize the password hash: the client only needs these fields.
      user: { id: newUser.id, name: newUser.name, email: newUser.email },
    },
  });
};

export const signin = async (req: Request, res: Response): Promise<any> => {
  const body = req.body;
  const validation = SigninSchema.safeParse(body);

  if (validation.error) {
    return res.status(422).json({
      message: 'Invalid credentials',
      error: formatZodError(validation.error),
    });
  }

  const user = await client.user.findUnique({
    where: {
      email: validation?.data?.email,
    },
  });

  if (!user) {
    return res.status(422).json({
      message: 'User does not exist',
      error: 'User does not exist',
    });
  }

  if (user && !bcrypt.compareSync(validation?.data?.password, user?.password)) {
    return res.status(422).json({
      message: 'Invalid credentials',
      error: {},
    });
  }

  const token = jwt.sign(
    {
      id: user?.id,
    },
    process.env.JWT_SECRET as string
  );

  // Set httpOnly cookie for secure authentication
  // Dev: sameSite: 'lax', secure: false (HTTP localhost)
  // Prod: sameSite: 'none', secure: true (HTTPS cross-origin)
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: isProduction, // true for HTTPS in production, false for HTTP in dev
    sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-origin in prod, 'lax' for same-origin in dev
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });

  return res.status(200).json({
    message: 'Signin successful',
    data: {
      id: user?.id,
      name: user?.name,
      email: user?.email,
      token, // Still include for backward compatibility
    },
  });
};

export const getUserDetails = async (req: Request, res: Response): Promise<any> => {
  const requestedUserId = Number(req.params.userId);
  // @ts-ignore - req.id is set by authMiddleware
  const callerId = Number(req.id);

  if (!Number.isSafeInteger(requestedUserId) || requestedUserId < 1) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  // This endpoint is self-service only: a user may fetch their own record.
  if (requestedUserId !== callerId) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const user = await client.user.findFirst({
    where: { id: requestedUserId },
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    return res.status(404).json({ message: 'User not found!' });
  }

  return res.status(200).json({
    message: 'User fetched successfully',
    data: {
      // Explicit projection: never leak the password hash even if the
      // database client/driver returns more columns than requested.
      user: { id: user.id, name: user.name, email: user.email },
    },
  });
};

export const getCurrentUser = async (req: Request, res: Response): Promise<any> => {
  // @ts-ignore - req.id is set by authMiddleware
  const userId = req.id;

  if (!userId) {
    return res.status(401).json({
      message: 'Unauthorized',
    });
  }

  const user = await client.user.findUnique({
    where: {
      id: parseInt(userId),
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  if (!user) {
    return res.status(404).json({
      message: 'User not found',
    });
  }

  return res.status(200).json({
    message: 'User fetched successfully',
    user,
  });
};

export const logout = async (req: Request, res: Response): Promise<any> => {
  // Clear the auth cookie (must match signin cookie settings)
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('auth_token', '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 0, // Expire immediately
    path: '/',
  });

  return res.status(200).json({
    message: 'Logged out successfully',
  });
};
