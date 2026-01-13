// API Configuration
// Uses environment variables in production, localhost in development
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
export const HOOKS_URL = process.env.NEXT_PUBLIC_HOOKS_URL || 'http://localhost:8000';
