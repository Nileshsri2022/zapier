/**
 * Utility for handling OAuth redirects with state preservation
 */

/**
 * Redirects to OAuth URL while preserving Zap editor state in sessionStorage
 * @param authUrl - The OAuth URL to redirect to
 */
export const redirectToOAuth = (authUrl: string) => {
  // Save Zap state before OAuth redirect (if available)
  if (typeof window !== 'undefined' && (window as any).saveZapStateForOAuth) {
    (window as any).saveZapStateForOAuth();
  }

  // Redirect to OAuth URL
  window.location.href = authUrl;
};
