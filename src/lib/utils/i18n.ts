export function applyTemplateSubs(template: string, subs?: string | string[]) {
  if (!subs) return template
  const values = Array.isArray(subs) ? subs : [subs]
  let index = 0
  return template.replace(/\$(\d+|[A-Z_]+)\$?/g, () => values[index++] ?? '')
}

export function _t(
  key: string,
  subs?: string | string[],
  fallbackMessages?: Record<string, string>
) {
  if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
    const message = chrome.i18n.getMessage(key, subs)
    if (message) return message
  }

  if (fallbackMessages && key in fallbackMessages) {
    return applyTemplateSubs(fallbackMessages[key], subs)
  }

  return key
}
