/**
 * Utility for handling OAuth redirects with state preservation
 */

export interface PendingOAuthSelection {
  selectedItem: any;
  selectedApp: any;
  modalFor: number; // 1 = trigger, >1 = action
}

/**
 * Saves the Modal's pending selection before OAuth redirect
 */
export const savePendingSelection = (selection: PendingOAuthSelection) => {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('zapmate_pending_selection', JSON.stringify(selection));
  }
};

/**
 * Gets the pending selection after OAuth redirect
 */
export const getPendingSelection = (): PendingOAuthSelection | null => {
  if (typeof window === 'undefined') return null;
  const saved = sessionStorage.getItem('zapmate_pending_selection');
  if (saved) {
    sessionStorage.removeItem('zapmate_pending_selection');
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  }
  return null;
};

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
