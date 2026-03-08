/**
 * Chrome Offscreen API Usage Guide
 * 
 * This file provides practical examples of how to use the offscreen manager
 * with proper reasons and justifications based on Chrome's official documentation.
 */

import {
  ensureOffscreenDocument,
  withOffscreen,
  sendToOffscreen,
  getRecommendedJustification,
  getRecommendedJustificationForReasons,
  OFFSCREEN_JUSTIFICATIONS,
  type OffscreenReason
} from './offscreen-manager';

/**
 * Example 1: Video Processing with Blobs
 * Use case: Processing video files for download or upload
 */
export async function processVideoFile(videoBlob: Blob): Promise<Blob> {
  return await withOffscreen(
    async () => {
      const response = await sendToOffscreen({
        type: 'PROCESS_VIDEO',
        data: videoBlob
      });
      return response.processedBlob;
    },
    {
      reasons: ['BLOBS', 'WORKERS'],
      // Automatic justification: "Extension requires blob processing, background processing capabilities for core functionality"
      keepAlive: true
    }
  );
}

/**
 * Example 2: Screen Recording with Display Media
 * Use case: Capturing screen content for recording
 */
export async function startScreenRecording(): Promise<MediaStream> {
  return await withOffscreen(
    async () => {
      const response = await sendToOffscreen({
        type: 'START_SCREEN_CAPTURE'
      });
      return response.stream;
    },
    {
      reasons: ['DISPLAY_MEDIA', 'WEB_RTC'],
      // Custom justification for specific use case
      justification: 'Capture screen content and establish WebRTC connections for screen recording functionality'
    }
  );
}

/**
 * Example 3: Audio Notification System
 * Use case: Playing notification sounds in background
 */
export async function playNotificationSound(soundUrl: string): Promise<void> {
  await withOffscreen(
    async () => {
      await sendToOffscreen({
        type: 'PLAY_NOTIFICATION',
        soundUrl
      });
    },
    {
      reasons: ['AUDIO_PLAYBACK'],
      // Uses recommended justification: "Play audio notifications and sounds in the background without user interaction"
      keepAlive: false // Auto-close after 30 seconds of no audio
    }
  );
}

/**
 * Example 4: Data Processing with Web Workers
 * Use case: Heavy computation without blocking UI
 */
export async function processLargeDataset(data: ArrayBuffer): Promise<any> {
  return await withOffscreen(
    async () => {
      // Convert ArrayBuffer to transferable format
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(data)));
      
      const response = await sendToOffscreen({
        type: 'PROCESS_DATA',
        data: base64Data
      });
      
      return response.result;
    },
    {
      reasons: ['WORKERS', 'BLOBS'],
      keepAlive: true
    }
  );
}

/**
 * Example 5: Clipboard Operations
 * Use case: Copy processed data to clipboard
 */
export async function copyProcessedDataToClipboard(data: string): Promise<boolean> {
  try {
    return await withOffscreen(
      async () => {
        const response = await sendToOffscreen({
          type: 'COPY_TO_CLIPBOARD',
          data
        });
        return response.success;
      },
      {
        reasons: ['CLIPBOARD'],
        // Uses recommended justification automatically
        keepAlive: true
      }
    );
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Example 6: Web Scraping with iframes
 * Use case: Extract data from external websites
 */
export async function scrapeWebsiteData(url: string): Promise<any> {
  return await withOffscreen(
    async () => {
      const response = await sendToOffscreen({
        type: 'SCRAPE_WEBSITE',
        url
      });
      return response.extractedData;
    },
    {
      reasons: ['IFRAME_SCRIPTING', 'DOM_SCRAPING'],
      justification: 'Embed external websites in iframes and extract data for content analysis'
    }
  );
}

/**
 * Example 7: Location-based Features
 * Use case: Get user location for location-aware functionality
 */
export async function getUserLocationData(): Promise<GeolocationPosition> {
  return await withOffscreen(
    async () => {
      const response = await sendToOffscreen({
        type: 'GET_LOCATION'
      });
      return response.position;
    },
    {
      reasons: ['GEOLOCATION'],
      keepAlive: false // One-time operation
    }
  );
}

/**
 * Example 8: Battery-aware Operations
 * Use case: Adjust functionality based on battery status
 */
export async function checkBatteryAndAdjustPerformance(): Promise<void> {
  await withOffscreen(
    async () => {
      const response = await sendToOffscreen({
        type: 'CHECK_BATTERY_STATUS'
      });
      
      if (response.batteryLevel < 0.2) {
        // Reduce performance on low battery
        await sendToOffscreen({
          type: 'ENABLE_POWER_SAVING_MODE'
        });
      }
    },
    {
      reasons: ['BATTERY_STATUS'],
      keepAlive: false
    }
  );
}

/**
 * Example 9: Responsive Design with Media Queries
 * Use case: Adapt UI based on viewport changes
 */
export async function setupResponsiveHandling(): Promise<void> {
  await ensureOffscreenDocument({
    reasons: ['MATCH_MEDIA'],
    // Uses automatic justification
  });
  
  // Set up media query listeners in offscreen document
  await sendToOffscreen({
    type: 'SETUP_MEDIA_QUERIES',
    queries: [
      '(max-width: 768px)',
      '(prefers-color-scheme: dark)',
      '(orientation: landscape)'
    ]
  });
}

/**
 * Example 10: Multi-purpose Document Setup
 * Use case: Create a versatile offscreen document for multiple operations
 */
export async function setupMultiPurposeOffscreenDocument(): Promise<void> {
  const reasons: OffscreenReason[] = [
    'BLOBS',
    'WORKERS', 
    'CLIPBOARD',
    'DOM_PARSER',
    'LOCAL_STORAGE'
  ];
  
  const result = await ensureOffscreenDocument({
    reasons,
    // Automatic justification will combine all capabilities
    url: 'multi-purpose-offscreen.html'
  });
  
  if (!result.success) {
    throw new Error(`Failed to setup multi-purpose offscreen document: ${result.error}`);
  }
  
  console.log('Multi-purpose offscreen document ready with capabilities:');
  reasons.forEach(reason => {
    console.log(`- ${reason}: ${getRecommendedJustification(reason)}`);
  });
}

/**
 * Utility: Display all available justifications
 */
export function displayAllJustifications(): void {
  console.log('Available Offscreen Reasons and Justifications:');
  console.log('='.repeat(50));
  
  Object.entries(OFFSCREEN_JUSTIFICATIONS).forEach(([reason, justification]) => {
    console.log(`${reason}:`);
    console.log(`  ${justification}`);
    console.log('');
  });
}

/**
 * Utility: Validate reason combinations
 */
export function validateReasonCombination(reasons: OffscreenReason[]): {
  valid: boolean;
  warnings: string[];
  suggestions: string[];
} {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  
  // Check for AUDIO_PLAYBACK with other long-running reasons
  if (reasons.includes('AUDIO_PLAYBACK') && reasons.length > 1) {
    warnings.push('AUDIO_PLAYBACK documents auto-close after 30 seconds without audio');
    suggestions.push('Consider using separate documents for audio and other operations');
  }
  
  // Check for testing in production
  if (reasons.includes('TESTING')) {
    warnings.push('TESTING reason should only be used in development');
    suggestions.push('Remove TESTING reason for production builds');
  }
  
  // Suggest combinations
  if (reasons.includes('BLOBS') && !reasons.includes('WORKERS')) {
    suggestions.push('Consider adding WORKERS for blob processing performance');
  }
  
  if (reasons.includes('USER_MEDIA') && !reasons.includes('WEB_RTC')) {
    suggestions.push('Consider adding WEB_RTC if you plan to stream user media');
  }
  
  return {
    valid: warnings.length === 0,
    warnings,
    suggestions
  };
}
