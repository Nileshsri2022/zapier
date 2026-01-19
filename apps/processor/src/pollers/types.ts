/**
 * Type definitions for the generic polling system
 */

export interface PollResult {
  service: string;
  processed: number;
  errors: number;
  duration: number;
}

export interface OAuthServerBase {
  id: string;
  refreshToken: string;
  accessToken: string;
  tokenExpiry: Date | null;
}

export interface TriggerBase {
  id: string;
  zapId: string;
  isActive: boolean;
  lastPolledAt: Date | null;
}

export interface TriggerWithServer<T extends TriggerBase, S extends OAuthServerBase> {
  trigger: T;
  server: S;
}
