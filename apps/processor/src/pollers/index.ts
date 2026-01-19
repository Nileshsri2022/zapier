/**
 * Poll Orchestrator
 * Manages all pollers and provides unified polling interface
 */

import { BasePoller } from './BasePoller';
import { GoogleSheetsPoller } from './GoogleSheetsPoller';
import { GoogleCalendarPoller } from './GoogleCalendarPoller';
import { PollResult } from './types';

class PollOrchestrator {
  private pollers: Map<string, BasePoller> = new Map();

  /**
   * Register a poller
   */
  register(poller: BasePoller): void {
    this.pollers.set(poller.name, poller);
    console.log(`📋 Registered poller: ${poller.name}`);
  }

  /**
   * Get list of registered poller names
   */
  getRegisteredPollers(): string[] {
    return Array.from(this.pollers.keys());
  }

  /**
   * Poll all registered services
   */
  async pollAll(): Promise<PollResult[]> {
    console.log('🔄 Starting poll for all services...');
    const results: PollResult[] = [];

    for (const [name, poller] of this.pollers) {
      try {
        const result = await poller.poll();
        results.push(result);
      } catch (error) {
        console.error(`❌ Poller ${name} failed:`, error);
        results.push({
          service: name,
          processed: 0,
          errors: 1,
          duration: 0,
        });
      }
    }

    const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
    console.log(`🔄 Poll complete: ${totalProcessed} processed, ${totalErrors} errors`);

    return results;
  }

  /**
   * Poll a specific service by name
   */
  async pollService(serviceName: string): Promise<PollResult | null> {
    const poller = this.pollers.get(serviceName);
    if (!poller) {
      console.warn(`⚠️ No poller found for service: ${serviceName}`);
      return null;
    }

    try {
      return await poller.poll();
    } catch (error) {
      console.error(`❌ Poller ${serviceName} failed:`, error);
      return {
        service: serviceName,
        processed: 0,
        errors: 1,
        duration: 0,
      };
    }
  }
}

// Create singleton instance
export const orchestrator = new PollOrchestrator();

// Register all pollers
orchestrator.register(new GoogleSheetsPoller());
orchestrator.register(new GoogleCalendarPoller());

// Export types and classes
export { BasePoller } from './BasePoller';
export { GoogleSheetsPoller } from './GoogleSheetsPoller';
export { GoogleCalendarPoller } from './GoogleCalendarPoller';
export * from './types';
