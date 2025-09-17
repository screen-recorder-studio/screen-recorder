/**
 * Chrome Offscreen API Usage Examples
 * 
 * This file demonstrates common patterns and use cases for the offscreen manager.
 * These examples show how to integrate offscreen documents into your Chrome extension.
 */

import {
  ensureOffscreenDocument,
  withOffscreen,
  sendToOffscreen,
  closeOffscreenDocument,
  hasOffscreenDocument,
  getRecommendedJustification,
  type WithOffscreenOptions,
  type OffscreenReason
} from './offscreen-manager';

/**
 * Example 1: Basic offscreen document for blob processing
 */
export async function setupBlobProcessing(): Promise<void> {
  const result = await ensureOffscreenDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS']
    // justification will be automatically generated using getRecommendedJustification
  });

  if (!result.success) {
    throw new Error(`Failed to setup blob processing: ${result.error}`);
  }
}

/**
 * Example: Using recommended justifications
 */
export function demonstrateJustifications(): void {
  // Get justification for a single reason
  const blobJustification = getRecommendedJustification('BLOBS');
  console.log('BLOBS justification:', blobJustification);

  // Get justification for multiple reasons
  const reasons: OffscreenReason[] = ['CLIPBOARD', 'WORKERS', 'BLOBS'];
  const combinedJustification = getRecommendedJustification(reasons[0]); // Just use first one for demo
  console.log('Combined justification:', combinedJustification);
}

/**
 * Example 2: Audio playback with automatic cleanup
 */
export async function playAudioInBackground(audioUrl: string): Promise<void> {
  await withOffscreen(
    async () => {
      // Send audio URL to offscreen document
      await sendToOffscreen({
        type: 'PLAY_AUDIO',
        url: audioUrl
      });
    },
    {
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play notification sounds in background',
      keepAlive: false // Auto-close after function completes
    }
  );
}

/**
 * Example 3: Clipboard operations
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    return await withOffscreen(
      async () => {
        const response = await sendToOffscreen({
          type: 'COPY_TO_CLIPBOARD',
          text
        });
        return response.success;
      },
      {
        reasons: ['CLIPBOARD'],
        justification: 'Copy processed data to user clipboard',
        keepAlive: true // Keep alive for multiple clipboard operations
      }
    );
  } catch (error) {
    console.error('Clipboard operation failed:', error);
    return false;
  }
}

/**
 * Example 4: DOM parsing and scraping
 */
export async function parseHTMLContent(htmlContent: string): Promise<any> {
  return await withOffscreen(
    async () => {
      const response = await sendToOffscreen({
        type: 'PARSE_HTML',
        content: htmlContent
      });
      return response.parsedData;
    },
    {
      reasons: ['DOM_PARSER', 'DOM_SCRAPING'],
      justification: 'Parse and extract data from HTML content',
      keepAlive: true
    }
  );
}

/**
 * Example 5: Web Workers in offscreen document
 */
export async function processDataWithWorker(data: ArrayBuffer): Promise<ArrayBuffer> {
  return await withOffscreen(
    async () => {
      // Convert ArrayBuffer to base64 for message passing
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(data)));
      
      const response = await sendToOffscreen({
        type: 'PROCESS_WITH_WORKER',
        data: base64Data
      });
      
      // Convert response back to ArrayBuffer
      const binaryString = atob(response.processedData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    },
    {
      reasons: ['WORKERS', 'BLOBS'],
      justification: 'Process large datasets using Web Workers',
      keepAlive: true
    }
  );
}

/**
 * Example 6: Media stream processing
 */
export async function setupMediaProcessing(): Promise<void> {
  await ensureOffscreenDocument({
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'WEB_RTC'],
    justification: 'Process media streams for recording and analysis'
  });
}

/**
 * Example 7: Local storage operations
 */
export async function manageLocalStorage(key: string, value?: string): Promise<string | null> {
  return await withOffscreen(
    async () => {
      if (value !== undefined) {
        // Set value
        await sendToOffscreen({
          type: 'SET_LOCAL_STORAGE',
          key,
          value
        });
        return value;
      } else {
        // Get value
        const response = await sendToOffscreen({
          type: 'GET_LOCAL_STORAGE',
          key
        });
        return response.value;
      }
    },
    {
      reasons: ['LOCAL_STORAGE'],
      justification: 'Manage local storage data for extension',
      keepAlive: true
    }
  );
}

/**
 * Example 8: Iframe scripting and manipulation
 */
export async function processIframeContent(iframeUrl: string): Promise<any> {
  return await withOffscreen(
    async () => {
      const response = await sendToOffscreen({
        type: 'PROCESS_IFRAME',
        url: iframeUrl
      });
      return response.extractedData;
    },
    {
      reasons: ['IFRAME_SCRIPTING', 'DOM_SCRAPING'],
      justification: 'Extract and process data from embedded iframes',
      keepAlive: true
    }
  );
}

/**
 * Example 9: Battery and device information
 */
export async function getBatteryInfo(): Promise<any> {
  return await withOffscreen(
    async () => {
      const response = await sendToOffscreen({
        type: 'GET_BATTERY_INFO'
      });
      return response.batteryInfo;
    },
    {
      reasons: ['BATTERY_STATUS'],
      justification: 'Monitor device battery status for power management',
      keepAlive: false
    }
  );
}

/**
 * Example 10: Geolocation services
 */
export async function getCurrentLocation(): Promise<GeolocationPosition> {
  return await withOffscreen(
    async () => {
      const response = await sendToOffscreen({
        type: 'GET_LOCATION'
      });
      return response.position;
    },
    {
      reasons: ['GEOLOCATION'],
      justification: 'Access user location for location-based features',
      keepAlive: false
    }
  );
}

/**
 * Example 11: Lifecycle management in service worker
 */
export class OffscreenLifecycleManager {
  private isSetup = false;

  async setup(): Promise<void> {
    if (this.isSetup) return;

    const result = await ensureOffscreenDocument({
      reasons: ['BLOBS', 'WORKERS', 'CLIPBOARD'],
      justification: 'Core extension functionality requiring DOM access'
    });

    if (!result.success) {
      throw new Error(`Failed to setup offscreen document: ${result.error}`);
    }

    this.isSetup = true;
    console.log('Offscreen document lifecycle manager initialized');
  }

  async cleanup(): Promise<void> {
    if (!this.isSetup) return;

    const result = await closeOffscreenDocument();
    if (!result.success) {
      console.warn('Failed to cleanup offscreen document:', result.error);
    }

    this.isSetup = false;
    console.log('Offscreen document lifecycle manager cleaned up');
  }

  async isReady(): Promise<boolean> {
    return this.isSetup && await hasOffscreenDocument();
  }

  async ensureReady(): Promise<void> {
    if (!(await this.isReady())) {
      await this.setup();
    }
  }
}

/**
 * Example 12: Error handling and retry logic
 */
export async function robustOffscreenOperation<T>(
  operation: () => Promise<T>,
  options: WithOffscreenOptions = {},
  maxRetries = 3
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await withOffscreen(operation, {
        ...options,
        forceRecreate: attempt > 1 // Recreate on retry
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Offscreen operation attempt ${attempt} failed:`, lastError.message);
      
      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw new Error(`Offscreen operation failed after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Example 13: Message routing for complex offscreen operations
 */
export class OffscreenMessageRouter {
  private messageHandlers = new Map<string, (data: any) => Promise<any>>();

  constructor() {
    // Set up message listener in service worker
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.target === 'offscreen' && this.messageHandlers.has(message.type)) {
        const handler = this.messageHandlers.get(message.type)!;
        handler(message.data)
          .then(result => sendResponse({ success: true, result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Async response
      }
    });
  }

  registerHandler(type: string, handler: (data: any) => Promise<any>): void {
    this.messageHandlers.set(type, handler);
  }

  async sendToOffscreen<T>(type: string, data: any): Promise<T> {
    const response = await sendToOffscreen({
      target: 'offscreen',
      type,
      data
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    return response.result;
  }
}

// Export a singleton instance for convenience
export const offscreenRouter = new OffscreenMessageRouter();
