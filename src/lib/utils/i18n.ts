// Global cache for loaded locale messages (web mode)
let cachedMessages: Record<string, string> = {}
let localeInitialized = false
let localeInitPromise: Promise<void> | null = null

// Session storage key for persisting language preference
const LANG_SESSION_KEY = 'screen_recorder_lang'

// All supported locales (matching static/_locales directories)
const SUPPORTED_LOCALES = [
  'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 
  'pt_BR', 'ru', 'tr', 'vi', 'zh_CN', 'zh_TW'
]

export function applyTemplateSubs(template: string, subs?: string | string[]) {
  if (!subs) return template
  const values = Array.isArray(subs) ? subs : [subs]
  let index = 0
  return template.replace(/\$(\d+|[A-Z_]+)\$?/g, () => values[index++] ?? '')
}

/**
 * Save language preference to session storage
 */
function saveLanguageToSession(lang: string): void {
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(LANG_SESSION_KEY, lang)
      console.log('[i18n] Language saved to session:', lang)
    } catch (e) {
      console.warn('[i18n] Failed to save language to session:', e)
    }
  }
}

/**
 * Get language preference from session storage
 */
function getLanguageFromSession(): string | null {
  if (typeof sessionStorage !== 'undefined') {
    try {
      return sessionStorage.getItem(LANG_SESSION_KEY)
    } catch (e) {
      console.warn('[i18n] Failed to read language from session:', e)
    }
  }
  return null
}

/**
 * Map browser language codes to our locale folder names
 */
function mapBrowserLanguage(browserLang: string): string {
  const langMap: Record<string, string> = {
    // Chinese variants
    'zh-CN': 'zh_CN',
    'zh-TW': 'zh_TW',
    'zh-HK': 'zh_TW',
    'zh': 'zh_CN',
    // Portuguese variants
    'pt-BR': 'pt_BR',
    'pt': 'pt_BR',
    // Other languages - map to base locale
    'de-AT': 'de',
    'de-CH': 'de',
    'de-DE': 'de',
    'en-US': 'en',
    'en-GB': 'en',
    'en-AU': 'en',
    'es-ES': 'es',
    'es-MX': 'es',
    'es-AR': 'es',
    'fr-FR': 'fr',
    'fr-CA': 'fr',
    'it-IT': 'it',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
    'ru-RU': 'ru',
    'tr-TR': 'tr',
    'vi-VN': 'vi',
    'hi-IN': 'hi',
    'id-ID': 'id'
  }
  
  // Try exact match first
  if (langMap[browserLang]) return langMap[browserLang]
  
  // Try base language code
  const base = browserLang.split('-')[0]
  if (langMap[base]) return langMap[base]
  
  // Check if base language is directly supported
  if (SUPPORTED_LOCALES.includes(base)) return base
  
  return 'en'
}

/**
 * Detect language from URL parameter, session storage, or browser settings
 * Priority: URL param > Session storage > Browser language > 'en'
 */
export function detectLanguage(): string {
  if (typeof window === 'undefined') return 'en'
  
  // 1. Check URL parameter first (highest priority)
  const params = new URLSearchParams(window.location.search)
  const urlLang = params.get('l')
  if (urlLang && SUPPORTED_LOCALES.includes(urlLang)) {
    // Save to session for other pages to use
    saveLanguageToSession(urlLang)
    return urlLang
  }
  
  // 2. Check session storage (persisted from previous page)
  const sessionLang = getLanguageFromSession()
  if (sessionLang && SUPPORTED_LOCALES.includes(sessionLang)) {
    return sessionLang
  }
  
  // 3. Fallback to browser language
  const browserLang = navigator.language || (navigator as any).userLanguage || 'en'
  const mappedLang = mapBrowserLanguage(browserLang)
  
  return mappedLang
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
 * Returns a promise that resolves when initialization is complete
 */
export async function initI18n(): Promise<void> {
  // Skip if chrome.i18n is available (extension mode)
  if (hasChromeI18n()) {
    localeInitialized = true
    return
  }

  // Return existing promise if already initializing
  if (localeInitPromise) return localeInitPromise

  localeInitPromise = (async () => {
    const lang = detectLanguage()
    console.log('[i18n] Initializing web mode with language:', lang)
    cachedMessages = await loadLocaleMessages(lang)
    localeInitialized = true
    console.log('[i18n] Initialization complete, loaded', Object.keys(cachedMessages).length, 'messages')
  })()

  return localeInitPromise
}

/**
 * Wait for i18n to be initialized (useful for components)
 */
export async function waitForI18n(): Promise<void> {
  if (localeInitialized) return
  if (localeInitPromise) return localeInitPromise
  // If not initialized and no promise, trigger initialization
  return initI18n()
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
// This ensures translations start loading as early as possible
if (typeof window !== 'undefined' && !hasChromeI18n()) {
  initI18n().catch(e => console.error('[i18n] Auto-init failed:', e))
}
