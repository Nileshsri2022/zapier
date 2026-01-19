/**
 * Webhook Action - Send HTTP requests to external APIs
 */

interface WebhookResult {
  success: boolean;
  statusCode?: number;
  response?: any;
  error?: string;
}

interface WebhookOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

/**
 * Send a webhook HTTP request
 */
export async function sendWebhook(options: WebhookOptions): Promise<WebhookResult> {
  const { url, method, headers = {}, body, timeout = 30000 } = options;

  // Validate URL
  try {
    new URL(url);
  } catch {
    return { success: false, error: 'Invalid URL' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      signal: controller.signal,
    };

    // Add body for non-GET requests
    if (body && method !== 'GET') {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    let responseData: any;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    // Consider 2xx and 3xx as success
    if (response.ok || response.status < 400) {
      return {
        success: true,
        statusCode: response.status,
        response: responseData,
      };
    }

    return {
      success: false,
      statusCode: response.status,
      response: responseData,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { success: false, error: `Request timeout after ${timeout}ms` };
      }
      return { success: false, error: error.message };
    }
    return { success: false, error: 'Unknown error' };
  }
}
