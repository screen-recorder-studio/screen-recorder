<script lang="ts">
  import { Video, CircleDot, HardDrive, Sparkles, Scissors, Download } from '@lucide/svelte'
  import { _t as t } from '$lib/utils/i18n'

  interface Props {
    reason: 'no-recording' | 'invalid-recording' | 'opfs-unavailable' | 'load-failed'
    onStartRecording: () => void
    onOpenDrive: () => void
  }

  let { reason, onStartRecording, onOpenDrive }: Props = $props()

  const reasonText = $derived(() => {
    switch (reason) {
      case 'invalid-recording':
        return t('studio_emptyReasonInvalid')
      case 'opfs-unavailable':
        return t('studio_emptyReasonOpfs')
      case 'load-failed':
        return t('studio_emptyReasonLoadFailed')
      default:
        return t('studio_emptyDesc')
    }
  })
</script>

<div class="flex-1 flex items-center justify-center p-8">
  <div class="max-w-md w-full text-center">
    <!-- Icon -->
    <div class="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center mb-6">
      <Video class="w-10 h-10 text-blue-500" />
    </div>

    <!-- Title -->
    <h2 class="text-xl font-semibold text-gray-900 mb-2">
      {t('studio_emptyTitle')}
    </h2>

    <!-- Description -->
    <p class="text-sm text-gray-500 mb-8 leading-relaxed">
      {reasonText()}
    </p>

    <!-- Action buttons -->
    <div class="flex items-center justify-center gap-3 mb-8">
      <button
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        onclick={onStartRecording}
      >
        <CircleDot class="w-4 h-4" />
        {t('studio_emptyStartRecording')}
      </button>
      <button
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
        onclick={onOpenDrive}
      >
        <HardDrive class="w-4 h-4" />
        {t('studio_emptyOpenDrive')}
      </button>
    </div>

    <!-- Feature hints -->
    <div class="flex items-center justify-center gap-6 text-xs text-gray-400">
      <span class="flex items-center gap-1">
        <Sparkles class="w-3.5 h-3.5" />
        {t('studio_emptyFeaturePreview')}
      </span>
      <span class="flex items-center gap-1">
        <Scissors class="w-3.5 h-3.5" />
        {t('studio_emptyFeatureTrim')}
      </span>
      <span class="flex items-center gap-1">
        <Download class="w-3.5 h-3.5" />
        {t('studio_emptyFeatureExport')}
      </span>
    </div>
  </div>
</div>
