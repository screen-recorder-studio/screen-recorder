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
      {isUploading ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}"
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
        <span class="text-xs text-blue-600">{t('upload_processing')}</span>
      </div>
    {:else}
      <div class="flex flex-col items-center gap-2">
        <Upload class="w-6 h-6 text-gray-400" />
        <div class="text-xs text-gray-700 font-medium">{t('upload_drop_hint')}</div>
        <div class="text-xs text-gray-400">{t('upload_format_hint')}</div>
      </div>
    {/if}
  </div>

  <!-- Error message -->
  {#if uploadError}
    <div class="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
      <CircleAlert class="w-3.5 h-3.5 flex-shrink-0" />
      <span>{t(uploadError === 'Please select an image file' ? 'upload_error_select' : 'upload_error_failed')}</span>
    </div>
  {/if}

  <!-- Current image preview -->
  {#if currentType === 'image' && currentConfig.image}
    <div class="flex items-center gap-2 pt-2 border-t border-gray-200">
      <div
        class="w-12 h-8 border border-gray-300 rounded bg-cover bg-center flex-shrink-0"
        style="background-image: url({backgroundConfigStore.getCurrentBackgroundStyle().replace('url(', '').replace(')', '')});"
      ></div>
      <div class="flex-1 text-xs text-gray-600 truncate">
        <div>ID: {currentConfig.image.imageId}</div>
        <div class="text-gray-400">{currentConfig.image.fit} · {currentConfig.image.position}</div>
      </div>
    </div>
  {/if}
</div>
