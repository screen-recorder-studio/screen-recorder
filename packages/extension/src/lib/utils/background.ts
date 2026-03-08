// Chrome 扩展 Background Script 通信工具
// 提取自 ElementRegionSelector.svelte 的工具函数

/**
 * Chrome 扩展环境检测
 */
export function isExtensionEnvironment(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.runtime && !!chrome?.tabs
}

/**
 * 获取当前活动标签页ID
 */
export function getActiveTabId(): Promise<number | undefined> {
  if (!isExtensionEnvironment()) return Promise.resolve(undefined)
  
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id)
    })
  })
}

/**
 * 发送消息到 background script
 * @param type 消息类型
 * @param extra 额外参数
 * @returns Promise<any>
 */
export async function sendToBackground(type: string, extra: any = {}): Promise<any> {
  if (!isExtensionEnvironment()) return
  
  const tabId = await getActiveTabId()
  return chrome.runtime.sendMessage({ type, tabId, ...extra })
}

/**
 * 监听来自 background 的消息
 * @param callback 消息处理回调函数
 * @returns 清理函数
 */
export function onBackgroundMessage(callback: (message: any) => void): (() => void) | null {
  if (!isExtensionEnvironment()) return null
  
  chrome.runtime.onMessage.addListener(callback)
  
  // 返回清理函数
  return () => {
    chrome.runtime.onMessage.removeListener(callback)
  }
}

/**
 * 初始化并获取 background 状态
 * @returns Promise<any>
 */
export async function initBackgroundState(): Promise<any> {
  if (!isExtensionEnvironment()) {
    return { mode: 'element', selecting: false, recording: false }
  }
  
  const tabId = await getActiveTabId()
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_STATE', tabId }, (resp) => {
      const state = resp?.state || { mode: 'element', selecting: false, recording: false }
      resolve(state)
    })
  })
}
