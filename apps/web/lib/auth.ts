import axios from 'axios';
import { API_URL } from './config';

/**
 * Authenticated API client using httpOnly cookies
 * No need to manually pass tokens - cookies are sent automatically
 */
export const authApi = axios.create({
  baseURL: API_URL,
  withCredentials: true, // CRITICAL: This sends cookies with every request
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Fetch wrapper for authenticated requests
 * Uses cookies for authentication (no manual token handling)
 */
export const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
  return fetch(url, {
    ...options,
    credentials: 'include', // CRITICAL: Send cookies with fetch
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
};

/**
 * Helper to check if user is authenticated (by calling /api/auth/me)
 */
export const checkAuth = async (): Promise<{ authenticated: boolean; user?: any }> => {
  try {
    const response = await authApi.get('/api/auth/me');
    return { authenticated: true, user: response.data.user };
  } catch {
    return { authenticated: false };
  }
};

/**
 * Logout - calls API to clear httpOnly cookie
 */
export const logout = async (): Promise<boolean> => {
  try {
    await authApi.post('/api/auth/logout');
    // Clear non-sensitive user data from localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('user');
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Get stored user data (non-sensitive, from localStorage)
 * Token is NOT stored in localStorage - it's in httpOnly cookie
 */
export const getStoredUser = (): { id?: number; name?: string; email?: string } | null => {
  if (typeof localStorage === 'undefined') return null;

  const userStr = localStorage.getItem('user');
  if (!userStr) return null;

  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
};

/**
 * Store user data (non-sensitive only)
 */
export const storeUser = (user: { id: number; name: string; email: string }): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('user', JSON.stringify(user));
};
