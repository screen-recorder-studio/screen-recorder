/**
 * Chrome Offscreen API Manager
 * 
 * Provides utilities for managing Chrome Extension offscreen documents.
 * Reference: https://developer.chrome.com/docs/extensions/reference/api/offscreen
 * 
 * Offscreen documents allow extensions to use DOM APIs in a hidden document
 * without interrupting the user experience. They are useful for:
 * - Audio/video processing
 * - Blob manipulation
 * - DOM parsing
 * - Web Workers
 * - Clipboard operations
 * - And more...
 */

/**
 * Valid reasons for creating an offscreen document.
 * Each reason determines the document's capabilities and lifespan.
 * Based on Chrome Offscreen API documentation.
 */
export type OffscreenReason =
  | 'TESTING'           // A reason used for testing purposes only
  | 'AUDIO_PLAYBACK'    // Playing audio (auto-closes after 30s without audio)
  | 'IFRAME_SCRIPTING'  // Embedding and scripting iframes to modify content
  | 'DOM_SCRAPING'      // Embedding iframes and scraping DOM to extract information
  | 'BLOBS'             // Interacting with Blob objects (including URL.createObjectURL())
  | 'DOM_PARSER'        // Using the DOMParser API
  | 'USER_MEDIA'        // Interacting with media streams from user media (e.g. getUserMedia())
  | 'DISPLAY_MEDIA'     // Interacting with media streams from display media (e.g. getDisplayMedia())
  | 'WEB_RTC'           // Using WebRTC APIs
  | 'CLIPBOARD'         // Interacting with the Clipboard API
  | 'LOCAL_STORAGE'     // Accessing localStorage
  | 'WORKERS'           // Spawning workers
  | 'BATTERY_STATUS'    // Using navigator.getBattery
  | 'MATCH_MEDIA'       // Using window.matchMedia
  | 'GEOLOCATION';      // Using navigator.geolocation

/**
 * Options for creating an offscreen document
 */
export interface CreateOffscreenOptions {
  /** 
   * The relative URL to load in the offscreen document.
   * Must be a static HTML file bundled with the extension.
   * @default 'offscreen.html'
   */
  url?: string;
  
  /** 
   * The reason(s) for creating the offscreen document.
   * Choose the minimal set required for your use case.
   */
  reasons: OffscreenReason[];
  
  /** 
   * Human-readable justification explaining why the offscreen document is needed.
   * This may be displayed to users and should be clear and specific.
   */
  justification: string;
}

/**
 * Options for ensuring an offscreen document exists
 */
export interface EnsureOffscreenOptions extends Partial<CreateOffscreenOptions> {
  /** 
   * Whether to force recreation if document already exists
   * @default false
   */
  forceRecreate?: boolean;
}

/**
 * Options for the withOffscreen utility function
 */
export interface WithOffscreenOptions extends EnsureOffscreenOptions {
  /** 
   * Whether to keep the offscreen document alive after the function completes
   * @default true
   */
  keepAlive?: boolean;
}

/**
 * Result of offscreen document operations
 */
export interface OffscreenResult {
  success: boolean;
  error?: string;
}

/**
 * Recommended justifications for each offscreen reason.
 * These provide clear explanations that may be shown to users.
 */
export const OFFSCREEN_JUSTIFICATIONS: Record<OffscreenReason, string> = {
  TESTING: 'Used for testing extension functionality in development environment',
  AUDIO_PLAYBACK: 'Play audio notifications and sounds in the background without user interaction',
  IFRAME_SCRIPTING: 'Embed and script iframes to modify their content for data processing',
  DOM_SCRAPING: 'Embed iframes and extract information from their DOM structure',
  BLOBS: 'Process and manipulate binary data using Blob objects and URL.createObjectURL()',
  DOM_PARSER: 'Parse HTML and XML content using the DOMParser API for data extraction',
  USER_MEDIA: 'Access and process user media streams from camera and microphone',
  DISPLAY_MEDIA: 'Capture and process screen sharing and display media streams',
  WEB_RTC: 'Establish peer-to-peer connections and handle real-time communication',
  CLIPBOARD: 'Read from and write to the system clipboard for data transfer',
  LOCAL_STORAGE: 'Access browser localStorage for persistent data storage',
  WORKERS: 'Spawn Web Workers for intensive background data processing',
  BATTERY_STATUS: 'Monitor device battery status for power management features',
  MATCH_MEDIA: 'Query media features and respond to viewport changes',
  GEOLOCATION: 'Access user location information for location-based features'
};

/**
 * Get recommended justification for a given reason
 */
export function getRecommendedJustification(reason: OffscreenReason): string {
  return OFFSCREEN_JUSTIFICATIONS[reason];
}

/**
 * Get recommended justification for multiple reasons
 */
export function getRecommendedJustificationForReasons(reasons: OffscreenReason[]): string {
  if (reasons.length === 0) {
    return 'Background processing for extension functionality';
  }

  if (reasons.length === 1) {
    return getRecommendedJustification(reasons[0]);
  }

  // For multiple reasons, create a combined justification
  const capabilities = reasons.map(reason => {
    switch (reason) {
      case 'TESTING': return 'testing';
      case 'AUDIO_PLAYBACK': return 'audio playback';
      case 'IFRAME_SCRIPTING': return 'iframe scripting';
      case 'DOM_SCRAPING': return 'DOM scraping';
      case 'BLOBS': return 'blob processing';
      case 'DOM_PARSER': return 'HTML/XML parsing';
      case 'USER_MEDIA': return 'user media access';
      case 'DISPLAY_MEDIA': return 'screen capture';
      case 'WEB_RTC': return 'WebRTC communication';
      case 'CLIPBOARD': return 'clipboard operations';
      case 'LOCAL_STORAGE': return 'local storage access';
      case 'WORKERS': return 'background processing';
      case 'BATTERY_STATUS': return 'battery monitoring';
      case 'MATCH_MEDIA': return 'media queries';
      case 'GEOLOCATION': return 'location services';
      default: return (reason as string).toLowerCase();
    }
  });

  return `Extension requires ${capabilities.join(', ')} capabilities for core functionality`;
}

/**
 * Check if the Chrome Offscreen API is available
 */
export function isOffscreenSupported(): boolean {
  return typeof chrome !== 'undefined' &&
         'offscreen' in chrome &&
         typeof chrome.offscreen === 'object';
}

/**
 * Check if an offscreen document currently exists
 */
export async function hasOffscreenDocument(): Promise<boolean> {
  if (!isOffscreenSupported()) {
    return false;
  }

  try {
    // Use the newer hasDocument() method if available (Chrome 116+)
    if ('hasDocument' in chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
      return await chrome.offscreen.hasDocument();
    }

    // Fallback for older Chrome versions using runtime.getContexts()
    if ('getContexts' in chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType]
      });
      return contexts.length > 0;
    }

    // Last resort: try to query using clients.matchAll() in service worker context
    if (typeof globalThis !== 'undefined' && 'clients' in globalThis) {
      const clientsAPI = (globalThis as any).clients;
      if (clientsAPI && typeof clientsAPI.matchAll === 'function') {
        const matchedClients = await clientsAPI.matchAll();
        return matchedClients.some((client: any) =>
          client.url && client.url.includes(chrome.runtime.id)
        );
      }
    }

    return false;
  } catch (error) {
    console.warn('[OffscreenManager] Error checking document existence:', error);
    return false;
  }
}

/**
 * Create a new offscreen document
 */
export async function createOffscreenDocument(
  options: CreateOffscreenOptions
): Promise<OffscreenResult> {
  if (!isOffscreenSupported()) {
    return {
      success: false,
      error: 'Offscreen API not supported'
    };
  }

  try {
    const url = chrome.runtime.getURL(options.url || 'offscreen.html');
    
    await chrome.offscreen.createDocument({
      url,
      reasons: options.reasons as chrome.offscreen.Reason[],
      justification: options.justification
    });

    console.log('[OffscreenManager] Document created successfully:', url);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[OffscreenManager] Failed to create document:', errorMessage);
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Close the current offscreen document if it exists
 */
export async function closeOffscreenDocument(): Promise<OffscreenResult> {
  if (!isOffscreenSupported()) {
    return {
      success: false,
      error: 'Offscreen API not supported'
    };
  }

  try {
    const exists = await hasOffscreenDocument();
    if (!exists) {
      return { success: true }; // Already closed
    }

    await chrome.offscreen.closeDocument();
    console.log('[OffscreenManager] Document closed successfully');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[OffscreenManager] Failed to close document:', errorMessage);
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Ensure an offscreen document exists, creating it if necessary
 */
export async function ensureOffscreenDocument(
  options: EnsureOffscreenOptions = {}
): Promise<OffscreenResult> {
  if (!isOffscreenSupported()) {
    return {
      success: false,
      error: 'Offscreen API not supported'
    };
  }

  try {
    const exists = await hasOffscreenDocument();
    
    if (exists && !options.forceRecreate) {
      return { success: true }; // Already exists
    }

    if (exists && options.forceRecreate) {
      const closeResult = await closeOffscreenDocument();
      if (!closeResult.success) {
        return closeResult;
      }
    }

    // Create new document with default options
    const reasons = options.reasons || ['BLOBS'];
    const createOptions: CreateOffscreenOptions = {
      url: options.url || 'offscreen.html',
      reasons,
      justification: options.justification || getRecommendedJustificationForReasons(reasons)
    };

    return await createOffscreenDocument(createOptions);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[OffscreenManager] Failed to ensure document:', errorMessage);
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Execute a function with an offscreen document, managing its lifecycle
 * 
 * @param fn Function to execute while offscreen document exists
 * @param options Configuration options
 * @returns Promise resolving to the function's return value
 */
export async function withOffscreen<T>(
  fn: () => Promise<T> | T,
  options: WithOffscreenOptions = {}
): Promise<T> {
  const keepAlive = options.keepAlive ?? true;

  // Ensure offscreen document exists with proper justification
  const reasons = options.reasons || ['BLOBS'];
  const ensureOptions = {
    ...options,
    reasons,
    justification: options.justification || getRecommendedJustificationForReasons(reasons)
  };

  const ensureResult = await ensureOffscreenDocument(ensureOptions);
  if (!ensureResult.success) {
    throw new Error(`Failed to ensure offscreen document: ${ensureResult.error}`);
  }

  try {
    // Execute the function
    return await fn();
  } finally {
    // Clean up if requested
    if (!keepAlive) {
      const closeResult = await closeOffscreenDocument();
      if (!closeResult.success) {
        console.warn('[OffscreenManager] Failed to close document after execution:', closeResult.error);
      }
    }
  }
}

/**
 * Get information about the current offscreen document
 */
export async function getOffscreenInfo(): Promise<{
  exists: boolean;
  contexts?: any[];
}> {
  const exists = await hasOffscreenDocument();

  if (!exists) {
    return { exists: false };
  }

  try {
    if ('getContexts' in chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType]
      });
      return { exists: true, contexts };
    }
  } catch (error) {
    console.warn('[OffscreenManager] Error getting context info:', error);
  }

  return { exists: true };
}

/**
 * Utility to send a message to the offscreen document and wait for response
 */
export async function sendToOffscreen<T = any>(
  message: any,
  options: EnsureOffscreenOptions = {}
): Promise<T> {
  // Ensure offscreen document exists with proper justification
  const reasons = options.reasons || ['BLOBS'];
  const ensureOptions = {
    ...options,
    reasons,
    justification: options.justification || getRecommendedJustificationForReasons(reasons)
  };

  const ensureResult = await ensureOffscreenDocument(ensureOptions);
  if (!ensureResult.success) {
    throw new Error(`Failed to ensure offscreen document: ${ensureResult.error}`);
  }

  // Send message and wait for response
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
