// Global cache for loaded locale messages (web mode)
let cachedMessages: Record<string, string> = {}
let localeInitialized = false
let localeInitPromise: Promise<void> | null = null

export function applyTemplateSubs(template: string, subs?: string | string[]) {
  if (!subs) return template
  const values = Array.isArray(subs) ? subs : [subs]
  let index = 0
  return template.replace(/\$(\d+|[A-Z_]+)\$?/g, () => values[index++] ?? '')
}

/**
 * Detect language from URL parameter or browser settings
 */
export function detectLanguage(): string {
  if (typeof window === 'undefined') return 'en'
  
  const params = new URLSearchParams(window.location.search)
  const urlLang = params.get('l')
  if (urlLang) return urlLang

  // Fallback to browser language
  const browserLang = navigator.language || (navigator as any).userLanguage || 'en'
  // Map common browser language codes to our locale folder names
  const langMap: Record<string, string> = {
    'zh-CN': 'zh_CN',
    'zh-TW': 'zh_TW',
    'zh': 'zh_CN',
    'pt-BR': 'pt_BR',
    'pt': 'pt_BR'
  }
  const base = browserLang.split('-')[0]
  return langMap[browserLang] || langMap[base] || base || 'en'
}

/**
 * Load locale messages from /_locales/{lang}/messages.json
 * Converts Chrome i18n format { "key": { "message": "Text" } } to flat { "key": "Text" }
 */
async function loadLocaleMessages(lang: string): Promise<Record<string, string>> {
  try {
    const response = await fetch(`/_locales/${lang}/messages.json`)
    if (!response.ok) {
      // Fallback to English if language not found
      if (lang !== 'en') {
        console.warn(`[i18n] Locale ${lang} not found, falling back to English`)
        return loadLocaleMessages('en')
      }
      return {}
    }
    const chromeFormat = await response.json()
    // Convert Chrome i18n format to flat object
    const flat: Record<string, string> = {}
    for (const key in chromeFormat) {
      if (chromeFormat[key]?.message) {
        flat[key] = chromeFormat[key].message
      }
    }
    return flat
  } catch (e) {
    console.error('[i18n] Failed to load locale messages:', e)
    if (lang !== 'en') {
      return loadLocaleMessages('en')
    }
    return {}
  }
}

/**
 * Check if running in Chrome extension context with i18n support
 */
function hasChromeI18n(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.i18n?.getMessage === 'function'
}

/**
 * Initialize i18n for web mode (non-extension)
 * Call this at app startup to preload locale messages
 */
export async function initI18n(): Promise<void> {
  // Skip if chrome.i18n is available (extension mode)
  if (hasChromeI18n()) {
    localeInitialized = true
    return
  }

  // Avoid duplicate initialization
  if (localeInitPromise) return localeInitPromise

  localeInitPromise = (async () => {
    const lang = detectLanguage()
    console.log('[i18n] Initializing web mode with language:', lang)
    cachedMessages = await loadLocaleMessages(lang)
    localeInitialized = true
  })()

  return localeInitPromise
}

/**
 * Get cached messages (for components that need direct access)
 */
export function getCachedMessages(): Record<string, string> {
  return cachedMessages
}

/**
 * Set cached messages directly (for manual initialization)
 */
export function setCachedMessages(messages: Record<string, string>): void {
  cachedMessages = messages
  localeInitialized = true
}

/**
 * Check if i18n has been initialized
 */
export function isI18nInitialized(): boolean {
  return localeInitialized
}

export function _t(
  key: string,
  subs?: string | string[],
  fallbackMessages?: Record<string, string>
) {
  // Try Chrome extension i18n first
  if (hasChromeI18n()) {
    const message = chrome.i18n.getMessage(key, subs)
    if (message) return message
  }

  // Try explicit fallback messages (passed as parameter)
  if (fallbackMessages && key in fallbackMessages) {
    return applyTemplateSubs(fallbackMessages[key], subs)
  }

  // Try cached messages (loaded via initI18n for web mode)
  if (cachedMessages && key in cachedMessages) {
    return applyTemplateSubs(cachedMessages[key], subs)
  }

  // Return key as last resort
  return key
}

// Auto-initialize i18n when module loads (for web mode)
// This ensures translations are available as soon as possible
if (typeof window !== 'undefined' && !hasChromeI18n()) {
  initI18n().catch(e => console.error('[i18n] Auto-init failed:', e))
}
