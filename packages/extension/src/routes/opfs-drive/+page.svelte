<script lang="ts">
  import { onMount } from 'svelte'
  import { Trash2, RefreshCw, Folder, HardDrive, FileText, Info, XCircle, AlertTriangle } from '@lucide/svelte'

  type RecSummary = {
    id: string
    dirName: string
    completed?: boolean
    createdAt?: number
    codec?: string
    width?: number
    height?: number
    fps?: number
    dataSize?: number
    indexSize?: number
    metaRaw?: any
    error?: string
    expanded?: boolean
    files?: Array<{ name: string; kind: 'file' | 'directory'; size?: number }>
  }

  let summaries = $state<RecSummary[]>([])
  let loading = $state(false)
  let usageInfo = $state<{usage: number, quota: number} | null>(null)
  let loadError = $state<string | null>(null)
  let originStr = $state<string>('')
  let opfsAvailable = $state<boolean>(false)
  let persisted = $state<boolean | null>(null)

  // 全部删除相关状态
  let showDeleteAllConfirm = $state(false)
  let deletingAll = $state(false)
  let deleteProgress = $state<{current: number, total: number} | null>(null)

  async function checkEnv() {
    try {
      originStr = location.origin
      // @ts-ignore
      opfsAvailable = typeof navigator?.storage?.getDirectory === 'function'
      // @ts-ignore
      persisted = typeof navigator?.storage?.persisted === 'function' ? await navigator.storage.persisted() : null
    } catch {
      opfsAvailable = false
      persisted = null
    }
  }

  async function requestPersist() {
    try {
      // @ts-ignore
      const ok = await navigator.storage.persist?.()
      persisted = !!ok
      await estimateUsage()
    } catch (e) {
      console.warn('persist() failed', e)
    }
  }

  async function estimateUsage() {
    try {
      // @ts-ignore
      const e = await navigator.storage.estimate()
      usageInfo = { usage: Math.round((e.usage || 0)), quota: Math.round((e.quota || 0)) }
    } catch (e:any) {
      console.warn('estimate failed', e)
    }
  }

  async function listRecordings() {
    loading = true
    loadError = null
    summaries = []
    try {
      // @ts-ignore - available in secure contexts
      const root: FileSystemDirectoryHandle = await navigator.storage.getDirectory()
      const list: RecSummary[] = []
      // iterate entries
      // @ts-ignore
      for await (const [name, handle] of root.entries()) {
        if (!name.startsWith('rec_')) continue
        if ((handle as any).kind !== 'directory') continue
        const recDir = handle as FileSystemDirectoryHandle
        const id = name.replace(/^rec_/, '')
        const summary: RecSummary = { id, dirName: name, expanded: false }
        try {
          // meta.json
          const metaHandle = await recDir.getFileHandle('meta.json', { create: false })
          const metaFile = await metaHandle.getFile()
          summary.indexSize = 0
          try {
            const text = await metaFile.text()
            const meta = JSON.parse(text)
            summary.metaRaw = meta
            summary.completed = !!meta.completed
            summary.createdAt = meta.createdAt
            summary.codec = meta.codec
            summary.width = meta.width
            summary.height = meta.height
            summary.fps = meta.fps
          } catch {}
          // data.bin size
          try {
            const dHandle = await recDir.getFileHandle('data.bin', { create: false })
            const df = await dHandle.getFile()
            summary.dataSize = df.size
          } catch {}
          // index.jsonl size
          try {
            const iHandle = await recDir.getFileHandle('index.jsonl', { create: false })
            const ifile = await iHandle.getFile()
            summary.indexSize = ifile.size
          } catch {}
        // list all files in this rec directory
        try {
          const files: Array<{ name: string; kind: 'file' | 'directory'; size?: number }> = []
          // @ts-ignore
          for await (const [fname, fh] of recDir.entries()) {
            const kind = (fh as any)?.kind === 'directory' ? 'directory' : 'file'
            let size: number | undefined
            if (kind === 'file') {
              try {
                const f = await (fh as FileSystemFileHandle).getFile()
                size = f.size
              } catch {}
            }
            files.push({ name: fname, kind, size })
          }
          summary.files = files.sort((a, b) => a.name.localeCompare(b.name))
        } catch {}

        } catch (e:any) {
          summary.error = e?.message || String(e)
        }
        list.push(summary)
      }
      // sort by createdAt desc
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      summaries = list
      await estimateUsage()
    } catch (e:any) {
      loadError = e?.message || String(e)
    } finally {
      loading = false
    }
  }

  async function deleteRecording(dirName: string) {
    if (!confirm(`确定要删除录制 "${dirName}" 吗？此操作不可撤销。`)) {
      return
    }

    try {
      // @ts-ignore
      const root: FileSystemDirectoryHandle = await navigator.storage.getDirectory()
      // @ts-ignore
      await root.removeEntry(dirName, { recursive: true })
      summaries = summaries.filter(s => s.dirName !== dirName)
      await estimateUsage()
    } catch (e:any) {
      alert('删除失败: ' + (e?.message || String(e)))
    }
  }

  async function deleteAllRecordings() {
    if (summaries.length === 0) return

    deletingAll = true
    deleteProgress = { current: 0, total: summaries.length }

    try {
      // @ts-ignore
      const root: FileSystemDirectoryHandle = await navigator.storage.getDirectory()

      const errors: string[] = []

      for (let i = 0; i < summaries.length; i++) {
        const summary = summaries[i]
        deleteProgress = { current: i + 1, total: summaries.length }

        try {
          // @ts-ignore
          await root.removeEntry(summary.dirName, { recursive: true })
        } catch (e: any) {
          errors.push(`${summary.dirName}: ${e?.message || String(e)}`)
        }

        // 添加小延迟避免阻塞UI
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // 重新加载列表
      await listRecordings()

      if (errors.length > 0) {
        alert(`部分删除失败:\n${errors.join('\n')}`)
      } else {
        alert('所有录制数据已成功删除')
      }

    } catch (e: any) {
      alert('批量删除失败: ' + (e?.message || String(e)))
    } finally {
      deletingAll = false
      deleteProgress = null
      showDeleteAllConfirm = false
    }
  }

  function confirmDeleteAll() {
    if (summaries.length === 0) {
      alert('没有可删除的录制数据')
      return
    }
    showDeleteAllConfirm = true
  }

  function cancelDeleteAll() {
    showDeleteAllConfirm = false
  }

  onMount(() => {
    // 添加键盘快捷键支持
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'r') {
          e.preventDefault()
          if (!loading && !deletingAll) {
            listRecordings()
          }
        }
      }
      if (e.key === 'Escape' && showDeleteAllConfirm) {
        cancelDeleteAll()
      }
    }

    document.addEventListener('keydown', handleKeydown)
    void (async () => {
      await checkEnv()
      await listRecordings()
    })()

    return () => {
      document.removeEventListener('keydown', handleKeydown)
    }
  })

  function formatBytes(n?: number) {
    if (!n || n <= 0) return '0 B'
    const units = ['B','KB','MB','GB','TB']
    let i = 0
    let v = n
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(2)} ${units[i]}`
  }

  function formatTime(ts?: number) {
    if (!ts) return '-'
    try { return new Date(ts).toLocaleString() } catch { return String(ts) }
  }
</script>

<svelte:head>
  <title>OPFS Drive 调试</title>
</svelte:head>

<div class="p-4 max-w-4xl mx-auto">
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-2">
      <HardDrive class="w-5 h-5 text-gray-700" />
      <h1 class="m-0 text-lg font-semibold">OPFS Drive 调试</h1>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        onclick={confirmDeleteAll}
        disabled={loading || deletingAll || summaries.length === 0}
        title={summaries.length === 0 ? '没有可删除的数据' : `删除所有 ${summaries.length} 个录制`}
      >
        <Trash2 class="inline w-4 h-4 mr-1" /> 全部删除
      </button>
      <button class="px-3 py-1.5 text-sm bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50" onclick={() => listRecordings()} disabled={loading || deletingAll}>
        <RefreshCw class="inline w-4 h-4 mr-1" /> 刷新
      </button>
    </div>
  </div>

  {#if usageInfo}
    <div class="mb-3 text-sm text-gray-700">
      存储用量: <b>{formatBytes(usageInfo.usage)}</b> / 配额: <b>{formatBytes(usageInfo.quota)}</b>
      <span class="text-xs text-gray-500">（{usageInfo.usage} B / {usageInfo.quota} B）</span>
    </div>
  {/if}

  <div class="mb-4 text-xs text-gray-700 border border-slate-200 rounded p-2 bg-slate-50">
    <div>来源: <b>{originStr}</b></div>
    <div>OPFS 可用: <b class={opfsAvailable ? 'text-green-700' : 'text-red-700'}>{opfsAvailable ? '是' : '否'}</b></div>
    <div class="flex items-center gap-2">
      持久化: <b class={persisted ? 'text-green-700' : 'text-yellow-700'}>{persisted === null ? '未知' : (persisted ? '是' : '否')}</b>
      {#if persisted === false}
        <button class="px-2 py-1 bg-slate-700 text-white rounded hover:bg-slate-800" onclick={() => requestPersist()}>申请持久化</button>
      {/if}
    </div>
    <div class="mt-2 pt-2 border-t border-slate-300 text-gray-500">
      💡 快捷键: Ctrl+R 刷新 | ESC 取消操作
    </div>
  </div>

  {#if loadError}
    <div class="p-3 mb-4 border border-red-200 text-red-800 bg-red-50 rounded flex items-center gap-2">
      <XCircle class="w-4 h-4" /> {loadError}
    </div>
  {/if}

  <!-- 全部删除确认对话框 -->
  {#if showDeleteAllConfirm}
    <div
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onclick={(e) => e.target === e.currentTarget && cancelDeleteAll()}
      onkeydown={(e) => e.key === 'Escape' && cancelDeleteAll()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      tabindex="-1"
    >
      <div
        class="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl"
        role="document"
      >
        <div class="flex items-center gap-3 mb-4">
          <AlertTriangle class="w-6 h-6 text-red-500" />
          <h3 id="delete-confirm-title" class="text-lg font-semibold text-gray-900">确认删除所有录制</h3>
        </div>
        <p class="text-gray-700 mb-6">
          您即将删除所有 <strong>{summaries.length}</strong> 个录制数据。此操作不可撤销，请确认是否继续？
        </p>
        <div class="flex justify-end gap-3">
          <button
            class="px-4 py-2 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
            onclick={cancelDeleteAll}
          >
            取消
          </button>
          <button
            class="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            onclick={deleteAllRecordings}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- 删除进度显示 -->
  {#if deletingAll && deleteProgress}
    <div class="mb-4 p-3 border border-blue-200 bg-blue-50 rounded">
      <div class="flex items-center gap-2 mb-2">
        <RefreshCw class="w-4 h-4 animate-spin text-blue-600" />
        <span class="text-sm font-medium text-blue-800">正在删除录制数据...</span>
      </div>
      <div class="text-xs text-blue-700 mb-2">
        进度: {deleteProgress.current} / {deleteProgress.total}
      </div>
      <div class="w-full bg-blue-200 rounded-full h-2">
        <div
          class="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style="width: {(deleteProgress.current / deleteProgress.total) * 100}%"
        ></div>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center gap-2 text-sm text-gray-500">
      <RefreshCw class="w-4 h-4 animate-spin" />
      加载中...
    </div>
  {:else if summaries.length === 0}
    <div class="text-center py-8">
      <Folder class="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <div class="text-sm text-gray-500">暂无录制数据</div>
      <div class="text-xs text-gray-400 mt-1">录制的数据将显示在这里</div>
    </div>
  {:else}
    <div class="mb-3 text-sm text-gray-600">
      共找到 <strong>{summaries.length}</strong> 个录制，总大小约 <strong>{formatBytes(summaries.reduce((sum, s) => sum + (s.dataSize || 0), 0))}</strong>
    </div>
    <div class="space-y-3">
      {#each summaries as s}
        <div class="border border-slate-200 rounded p-3 bg-white">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Folder class="w-4 h-4 text-slate-600" />
              <div class="text-sm font-medium">{s.dirName}</div>
            </div>
            <div class="flex items-center gap-2 text-xs text-slate-600">
              <span class="px-2 py-0.5 rounded bg-slate-100">{s.completed ? '已完成' : '进行中'}</span>
              <span class="px-2 py-0.5 rounded bg-slate-100">{formatBytes(s.dataSize)}</span>

              <button
                class="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                onclick={() => deleteRecording(s.dirName)}
                disabled={deletingAll}
              >
                <Trash2 class="inline w-3 h-3 mr-1" /> 删除
              </button>
            </div>
          </div>
          <div class="mt-2 text-xs text-slate-700">
            <div>创建时间: {formatTime(s.createdAt)} | 编解码: {s.codec || '-'} | 分辨率: {s.width}x{s.height} @ {s.fps || '-'}fps</div>
            {#if s.indexSize}
              <div>索引大小: {formatBytes(s.indexSize)}</div>
            {/if}
            {#if s.error}
              <div class="text-red-600">错误: {s.error}</div>
            {/if}
          </div>
          {#if s.metaRaw}
            <details class="mt-2">
              <summary class="text-xs cursor-pointer select-none flex items-center gap-1"><Info class="w-3 h-3"/> 查看 meta.json</summary>
              <pre class="mt-1 p-2 bg-slate-50 rounded text-[11px] overflow-auto">{JSON.stringify(s.metaRaw, null, 2)}</pre>
            </details>
          {/if}
          {#if s.files && s.files.length > 0}
            <div class="mt-2">
              <div class="text-xs font-semibold text-slate-700">文件</div>
              <ul class="mt-1 space-y-1">
                {#each s.files as f}
                  <li class="flex items-center justify-between text-xs">
                    <div class="flex items-center gap-1">
                      {#if f.kind === 'directory'}
                        <Folder class="w-3 h-3 text-slate-600" />
                      {:else}
                        <FileText class="w-3 h-3 text-slate-600" />
                      {/if}
                      <span>{f.name}</span>
                    </div>
                    {#if f.size != null}
                      <span class="text-slate-500">{formatBytes(f.size)}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  pre { max-height: 240px; }
</style>
