export function formatDateTimeToCustomString(dateTime: string | Date): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  };

  const parsedDateTime = dateTime instanceof Date ? dateTime : new Date(dateTime);

  return parsedDateTime.toLocaleString('en-US', options);
}

/**
 * Get session details from localStorage (user data only)
 * Token is stored in httpOnly cookie - not accessible from JS (secure!)
 */
export const getSessionDetails = () => {
  let session = {
    isLoggedIn: false,
    user: null as { id?: number; name?: string; email?: string } | null,
  };

  // Check if localStorage is available (browser environment)
  if (typeof localStorage !== 'undefined' && localStorage.getItem('user') !== null) {
    try {
      session = {
        isLoggedIn: true,
        user: JSON.parse(localStorage.getItem('user') as string),
      };
    } catch {
      // Invalid JSON in localStorage
      localStorage.removeItem('user');
    }
  }

  return session;
};

/**
 * Check if user is logged in (based on stored user data)
 * Note: Actual auth validation happens server-side via httpOnly cookie
 */
export const isLoggedIn = (): boolean => {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('user') !== null;
};
