type ChromeI18nPlaceholder = {
  content?: string
  example?: string
}

type ChromeI18nMessage = {
  message?: string
  placeholders?: Record<string, ChromeI18nPlaceholder>
}

type FallbackMessage = string | ChromeI18nMessage

// Global cache for loaded locale messages (web mode)
let cachedMessages: Record<string, ChromeI18nMessage> = {}
let localeInitialized = false
let localeInitPromise: Promise<void> | null = null

// Session storage key for persisting language preference
const LANG_SESSION_KEY = 'screen_recorder_lang'

// All supported locales (matching static/_locales directories)
const SUPPORTED_LOCALES = [
  'am', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'en_GB', 'es',
  'es_419', 'et', 'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'id',
  'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no', 'pl',
  'pt_BR', 'pt_PT', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th',
  'tr', 'uk', 'ur', 'vi', 'zh_CN', 'zh_TW'
] as const

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES)
const LATAM_SPANISH_REGIONS = new Set([
  '419', 'AR', 'BO', 'CL', 'CO', 'CR', 'DO', 'EC', 'GT', 'HN', 'MX',
  'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE'
])
const LOCALE_ALIASES: Record<string, string> = {
  'in': 'id',
  'in-id': 'id',
  'iw': 'he',
  'iw-il': 'he',
  'nb': 'no',
  'nb-no': 'no',
  'nn': 'no',
  'nn-no': 'no',
  'pt': 'pt_BR',
  'tl': 'fil',
  'tl-ph': 'fil',
  'zh': 'zh_CN',
  'zh-hans': 'zh_CN',
  'zh-hant': 'zh_TW',
  'zh-hk': 'zh_TW',
  'zh-mo': 'zh_TW'
}

function normalizeLocaleRegion(region?: string): string | null {
  if (!region) return null
  return /^[0-9]+$/.test(region) ? region : region.toUpperCase()
}

function resolveSupportedLocale(locale?: string | null): string | null {
  if (!locale) return null

  const trimmed = locale.trim()
  if (!trimmed) return null

  const lower = trimmed.toLowerCase()
  if (LOCALE_ALIASES[lower]) return LOCALE_ALIASES[lower]

  const parts = trimmed.replace(/_/g, '-').split('-').filter(Boolean)
  const base = parts[0]?.toLowerCase()
  const subtags = parts.slice(1)
  const normalizedSubtags = subtags
    .map((part) => normalizeLocaleRegion(part) || part.toUpperCase())
    .filter(Boolean)
  const region = normalizeLocaleRegion(subtags[subtags.length - 1])

  if (!base) return null

  if (base === 'zh') {
    if (normalizedSubtags.includes('HANT') || normalizedSubtags.includes('TW') || normalizedSubtags.includes('HK') || normalizedSubtags.includes('MO')) {
      return 'zh_TW'
    }
    if (normalizedSubtags.includes('HANS') || normalizedSubtags.includes('CN') || normalizedSubtags.includes('SG')) {
      return 'zh_CN'
    }
  }

  if (base === 'es' && region && LATAM_SPANISH_REGIONS.has(region)) {
    return 'es_419'
  }

  const candidates = [
    region ? `${base}_${region}` : null,
    base
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (SUPPORTED_LOCALE_SET.has(candidate)) return candidate
  }

  return null
}

export function applyTemplateSubs(
  template: string,
  subs?: string | string[],
  placeholders?: Record<string, ChromeI18nPlaceholder>
) {
  if (!subs) return template

  const values = Array.isArray(subs) ? subs : [subs]
  const namedValues = new Map<string, string>()

  for (const [name, placeholder] of Object.entries(placeholders || {})) {
    const indexMatch = placeholder?.content?.match(/^\$(\d+)$/)
    if (!indexMatch) continue

    const value = values[Number(indexMatch[1]) - 1] ?? ''
    namedValues.set(name.toUpperCase(), value)
  }

  let index = 0

  return template.replace(/\$(\d+|[A-Z0-9_]+)\$?/g, (_, token: string) => {
    if (/^\d+$/.test(token)) {
      return values[Number(token) - 1] ?? ''
    }

    if (namedValues.has(token)) {
      return namedValues.get(token) ?? ''
    }

    return values[index++] ?? ''
  })
}

function formatFallbackMessage(message: FallbackMessage, subs?: string | string[]) {
  if (typeof message === 'string') {
    return applyTemplateSubs(message, subs)
  }

  return applyTemplateSubs(message.message || '', subs, message.placeholders)
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
  return resolveSupportedLocale(browserLang) || 'en'
}

/**
 * Detect language from URL parameter, session storage, or browser settings
 * Priority: URL param > Session storage > Browser language > 'en'
 */
export function detectLanguage(): string {
  if (typeof window === 'undefined') return 'en'
  
  // 1. Check URL parameter first (highest priority)
  const params = new URLSearchParams(window.location.search)
  const urlLang = resolveSupportedLocale(params.get('l'))
  if (urlLang) {
    // Save to session for other pages to use
    saveLanguageToSession(urlLang)
    return urlLang
  }
  
  // 2. Check session storage (persisted from previous page)
  const sessionLang = resolveSupportedLocale(getLanguageFromSession())
  if (sessionLang) {
    return sessionLang
  }
  
  // 3. Fallback to browser language
  const browserLang = navigator.language || (navigator as any).userLanguage || 'en'
  const mappedLang = mapBrowserLanguage(browserLang)
  
  return mappedLang
}

async function fetchLocaleMessages(lang: string): Promise<Record<string, ChromeI18nMessage> | null> {
  try {
    const response = await fetch(`/_locales/${lang}/messages.json`)
    if (!response.ok) return null
    return await response.json()
  } catch (e) {
    console.error(`[i18n] Failed to fetch locale ${lang}:`, e)
    return null
  }
}

/**
 * Load locale messages from /_locales/{lang}/messages.json
 * Keeps Chrome i18n format so web fallback can preserve placeholders semantics
 */
async function loadLocaleMessages(lang: string): Promise<Record<string, ChromeI18nMessage>> {
  const messages = await fetchLocaleMessages(lang)
  if (!messages) {
    if (lang !== 'en') {
      console.warn(`[i18n] Locale ${lang} not found, falling back to English`)
      return loadLocaleMessages('en')
    }
    return {}
  }

  return messages
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
  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(cachedMessages)) {
    if (value?.message) flat[key] = value.message
  }
  return flat
}

/**
 * Set cached messages directly (for manual initialization)
 */
export function setCachedMessages(messages: Record<string, string | ChromeI18nMessage>): void {
  const normalized: Record<string, ChromeI18nMessage> = {}
  for (const [key, value] of Object.entries(messages)) {
    normalized[key] = typeof value === 'string' ? { message: value } : value
  }

  cachedMessages = normalized
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
  fallbackMessages?: Record<string, FallbackMessage>
) {
  // Try Chrome extension i18n first
  if (hasChromeI18n()) {
    const message = chrome.i18n.getMessage(key, subs)
    if (message) return message
  }

  // Try explicit fallback messages (passed as parameter)
  if (fallbackMessages && key in fallbackMessages) {
    return formatFallbackMessage(fallbackMessages[key], subs)
  }

  // Try cached messages (loaded via initI18n for web mode)
  if (cachedMessages && key in cachedMessages) {
    return formatFallbackMessage(cachedMessages[key], subs)
  }

  // Return key as last resort
  return key
}

// Auto-initialize i18n when module loads (for web mode)
// This ensures translations start loading as early as possible
if (typeof window !== 'undefined' && !hasChromeI18n()) {
  initI18n().catch(e => console.error('[i18n] Auto-init failed:', e))
}
