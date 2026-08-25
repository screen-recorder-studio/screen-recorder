<!-- Image Upload Panel - Drag & drop image upload -->
<script lang="ts">
  import { Upload, CircleAlert } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import { _t as t } from '$lib/utils/i18n'

  // Current config from store
  const currentConfig = $derived(backgroundConfigStore.config)
  const currentType = $derived(currentConfig.type)

  // Upload state
  let fileInput = $state<HTMLInputElement>()
  let isUploading = $state(false)
  let uploadError = $state<string>('')

  // Handle image upload
  async function handleImageUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    isUploading = true
    uploadError = ''

    try {
      const result = await backgroundConfigStore.handleImageUpload(file)
      console.log('🖼️ [ImageUploadPanel] Uploaded:', result.config.imageId)
    } catch (error) {
      console.error('🖼️ [ImageUploadPanel] Upload failed:', error)
      uploadError = error instanceof Error ? error.message : 'Upload failed'
    } finally {
      isUploading = false
      if (input) input.value = ''
    }
  }

  // Handle drag & drop
  function handleDrop(event: DragEvent) {
    event.preventDefault()
    const files = event.dataTransfer?.files
    if (files && files.length > 0 && files[0].type.startsWith('image/')) {
      handleImageUpload({ target: { files: [files[0]] } } as any)
    } else {
      uploadError = 'Please select an image file'
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault()
  }

  // Trigger file select
  function triggerFileSelect() {
    fileInput?.click()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      triggerFileSelect()
    }
  }

</script>

<div class="space-y-3">
  <!-- Hidden file input -->
  <input
    type="file"
    accept="image/*"
    bind:this={fileInput}
    onchange={handleImageUpload}
    class="hidden"
  />

  <!-- Upload area -->
  <div
    class="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
      {isUploading ? 'border-blue-400 bg-blue-500/10' : 'border-zinc-500 bg-zinc-950/40 hover:border-white/30 hover:bg-white/5'}"
    onclick={triggerFileSelect}
    ondrop={handleDrop}
    ondragover={handleDragOver}
    onkeydown={handleKeydown}
    role="button"
    tabindex="0"
  >
    {#if isUploading}
      <div class="flex flex-col items-center gap-2">
        <div class="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <span class="text-xs text-blue-300">{t('upload_processing')}</span>
      </div>
    {:else}
      <div class="flex flex-col items-center gap-2">
        <Upload class="h-6 w-6 text-zinc-400" />
        <div class="text-xs font-medium text-zinc-300">{t('upload_drop_hint')}</div>
        <div class="text-xs text-zinc-400">{t('upload_format_hint')}</div>
      </div>
    {/if}
  </div>

  <!-- Error message -->
  {#if uploadError}
    <div class="flex items-center gap-2 rounded border border-red-400/20 bg-red-500/10 p-2 text-xs text-red-300">
      <CircleAlert class="w-3.5 h-3.5 flex-shrink-0" />
      <span>{t(uploadError === 'Please select an image file' ? 'upload_error_select' : 'upload_error_failed')}</span>
    </div>
  {/if}

  <!-- Current image preview -->
  {#if currentType === 'image' && currentConfig.image}
    <div class="flex items-center gap-2 border-t border-zinc-700 pt-2">
      <div
        class="h-8 w-12 flex-shrink-0 rounded border border-zinc-500 bg-cover bg-center"
        style="background-image: url({backgroundConfigStore.getCurrentBackgroundStyle().replace('url(', '').replace(')', '')});"
      ></div>
      <div class="flex-1 truncate text-xs text-zinc-400">
        <div>ID: {currentConfig.image.imageId}</div>
        <div class="text-zinc-400">{currentConfig.image.fit} · {currentConfig.image.position}</div>
      </div>
    </div>
  {/if}
</div>
