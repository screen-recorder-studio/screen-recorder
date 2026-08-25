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
  <div class="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900/40 p-8 text-center shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
    <!-- Icon -->
    <div class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-blue-400/20 bg-gradient-to-br from-blue-500/15 to-violet-500/10 shadow-inner">
      <Video class="h-10 w-10 text-blue-300" />
    </div>

    <!-- Title -->
    <h2 class="mb-2 text-xl font-semibold text-zinc-100">
      {t('studio_emptyTitle')}
    </h2>

    <!-- Description -->
    <p class="mb-8 text-sm leading-relaxed text-zinc-400">
      {reasonText()}
    </p>

    <!-- Action buttons -->
    <div class="flex items-center justify-center gap-3 mb-8">
      <button
        class="studio-primary-action inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium"
        onclick={onStartRecording}
      >
        <CircleDot class="w-4 h-4" />
        {t('studio_emptyStartRecording')}
      </button>
      <button
        class="studio-muted-action inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium"
        onclick={onOpenDrive}
      >
        <HardDrive class="w-4 h-4" />
        {t('studio_emptyOpenDrive')}
      </button>
    </div>

    <!-- Feature hints -->
    <div class="flex items-center justify-center gap-6 text-xs text-zinc-400">
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
