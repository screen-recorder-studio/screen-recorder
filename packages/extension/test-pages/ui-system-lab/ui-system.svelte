<script lang="ts">
  import {
    AlertTriangle,
    ArrowRight,
    Check,
    CircleDot,
    FolderOpen,
    Info,
    LoaderCircle,
    Moon,
    Pause,
    Play,
    ScanLine,
    Sun,
    Trash2
  } from '@lucide/svelte'

  const themes = [
    { id: 'browser-light', label: 'Browser · Light', icon: Sun, theme: 'light' },
    { id: 'browser-dark', label: 'Browser · Dark', icon: Moon, theme: 'dark' },
    { id: 'workspace-dark', label: 'Workspace · Dark', icon: CircleDot, theme: 'workspace' }
  ] as const

  let activeTheme = $state<(typeof themes)[number]['id']>('browser-light')
  let selectedMode = $state('tab')
  let countdown = $state('3')
  let motionReduced = $state(false)

  const active = $derived(themes.find((theme) => theme.id === activeTheme) ?? themes[0])
</script>

<svelte:head>
  <title>UI System Lab · Screen Recorder Studio</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div
  class:reduced-motion={motionReduced}
  class="lab-shell"
  data-development-only="true"
  data-fixture="reduced-motion"
>
  <header class="lab-header">
    <div>
      <p class="eyebrow">Development surface</p>
      <h1>UI System Lab</h1>
      <p>对浏览器附着面、Studio 工作区、控件状态和边界内容进行可重复验证。</p>
    </div>
    <a href="/popup.html" class="lab-link">打开产品入口 <ArrowRight size={16} /></a>
  </header>

  <nav class="theme-switcher" aria-label="Preview theme">
    {#each themes as theme}
      {@const ThemeIcon = theme.icon}
      <button
        type="button"
        class:active={activeTheme === theme.id}
        aria-pressed={activeTheme === theme.id}
        data-fixture={theme.id}
        onclick={() => { activeTheme = theme.id }}
      >
        <ThemeIcon size={16} />
        {theme.label}
      </button>
    {/each}
    <label class="motion-toggle">
      <input type="checkbox" bind:checked={motionReduced} />
      Reduced motion
    </label>
  </nav>

  <main class="lab-grid" data-theme={active.theme}>
    <section class="specimen browser-specimen" aria-labelledby="entry-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Browser surface</p>
          <h2 id="entry-title">Recording entry</h2>
        </div>
        <span class="badge">360 px</span>
      </div>

      <div class="popup-frame">
        <div class="popup-heading">
          <span class="leading-icon video"><CircleDot size={18} /></span>
          <span><strong>Screen Recorder</strong><small>Choose a recording</small></span>
          <button class="icon-button" type="button" aria-label="Recording information"><Info size={16} /></button>
        </div>

        <label class="field-label" for="lab-countdown">
          Countdown
          <select id="lab-countdown" bind:value={countdown}>
            <option value="0">0s</option>
            <option value="3">3s</option>
            <option value="5">5s</option>
          </select>
        </label>

        <button class="gif-action" type="button">
          <span class="leading-icon"><ScanLine size={20} /></span>
          <span><strong>Record GIF</strong><small>Select a page area · Opens in Studio</small></span>
          <ArrowRight size={18} />
        </button>

        <fieldset class="mode-group">
          <legend>Video recording</legend>
          {#each ['tab', 'window', 'screen'] as mode}
            <button
              class:selected={selectedMode === mode}
              type="button"
              aria-pressed={selectedMode === mode}
              onclick={() => { selectedMode = mode }}
            >{mode}</button>
          {/each}
        </fieldset>

        <button class="primary-action" type="button"><Play size={17} /> Start video recording</button>
      </div>
    </section>

    <section class="specimen" aria-labelledby="states-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Interaction contract</p>
          <h2 id="states-title">Control states</h2>
        </div>
      </div>

      <div class="state-list">
        <div data-fixture="default"><span>Default</span><button class="secondary-action">Open recording</button></div>
        <div data-fixture="hover"><span>Hover</span><button class="secondary-action simulated-hover">Open recording</button></div>
        <div data-fixture="focus"><span>Focus</span><button class="secondary-action simulated-focus">Open recording</button></div>
        <div data-fixture="disabled"><span>Disabled</span><button class="secondary-action" disabled>Unavailable</button></div>
        <div data-fixture="busy"><span>Busy</span><button class="primary-action" aria-busy="true"><LoaderCircle class="spin" size={16} /> Saving…</button></div>
      </div>
    </section>

    <section class="specimen" aria-labelledby="status-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">State coverage</p>
          <h2 id="status-title">Feedback and recovery</h2>
        </div>
      </div>

      <div class="feedback-list">
        <div class="feedback info"><Info size={18} /><span><strong>Area selection ready</strong><small>Drag on the page, or press Esc to cancel.</small></span></div>
        <div class="feedback success"><Check size={18} /><span><strong>Saved to Recording Manager</strong><small>Your original recording remains available.</small></span></div>
        <div class="feedback error" data-fixture="error"><AlertTriangle size={18} /><span><strong>Export interrupted</strong><small>Check available storage and retry.</small></span><button>Retry</button></div>
      </div>
    </section>

    <section class="specimen" aria-labelledby="content-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Content pressure</p>
          <h2 id="content-title">Empty and long content</h2>
        </div>
      </div>

      <div class="empty-state" data-fixture="empty">
        <FolderOpen size={26} />
        <strong>No recordings yet</strong>
        <p>Your screen recordings and GIF captures will appear here.</p>
        <button class="primary-action"><CircleDot size={16} /> Start recording</button>
      </div>

      <article class="recording-row" data-fixture="long-copy">
        <div class="fake-thumbnail"><span>02:48</span></div>
        <div>
          <strong>Product-launch-localized-recording-name-that-must-wrap-without-hiding-actions</strong>
          <small>2026-08-24 · 3840 × 2160 · 842.6 MB</small>
        </div>
        <button class="icon-button" aria-label="Delete long-name recording"><Trash2 size={16} /></button>
      </article>
    </section>

    <section class="specimen workspace-preview" aria-labelledby="workspace-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Workspace surface</p>
          <h2 id="workspace-title">Studio dark</h2>
        </div>
        <span class="badge violet">GIF</span>
      </div>
      <div class="workspace-stage">
        <div class="canvas-preview"><ScanLine size={28} /><span>Canvas preview</span></div>
        <aside>
          <label>Format<select><option>GIF</option></select></label>
          <label>Width<input value="960" aria-label="Export width" /></label>
          <button class="gif-solid"><ScanLine size={16} /> Export GIF</button>
        </aside>
      </div>
    </section>

    <section class="specimen" aria-labelledby="recording-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Live state</p>
          <h2 id="recording-title">Recording controls</h2>
        </div>
      </div>
      <div class="recording-status"><span class="recording-dot"></span><strong>Recording</strong><time>00:12</time></div>
      <div class="paired-actions">
        <button class="secondary-action"><Pause size={16} /> Pause</button>
        <button class="danger-action"><span class="stop-square"></span> Stop & save</button>
      </div>
    </section>
  </main>
</div>

<style>
  :global(body) { margin: 0; background: #eef2f7; }
  :global(*) { box-sizing: border-box; }
  :global(button), :global(select), :global(input) { font: inherit; }
  .lab-shell { min-height: 100vh; padding: 32px; color: #0f172a; font-family: ui-sans-serif, system-ui, sans-serif; }
  .lab-header { display: flex; max-width: 1320px; margin: 0 auto 20px; align-items: end; justify-content: space-between; gap: 24px; }
  .lab-header h1 { margin: 2px 0 6px; font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.035em; }
  .lab-header p:not(.eyebrow) { max-width: 650px; margin: 0; color: #475569; line-height: 1.6; }
  .eyebrow { margin: 0; color: #2563eb; font-size: 11px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
  .lab-link { display: inline-flex; min-height: 44px; align-items: center; gap: 8px; color: #1d4ed8; font-size: 14px; font-weight: 700; text-decoration: none; }
  .theme-switcher { display: flex; max-width: 1320px; margin: 0 auto 20px; flex-wrap: wrap; gap: 8px; border: 1px solid #cbd5e1; border-radius: 14px; padding: 8px; background: #fff; }
  .theme-switcher button { display: inline-flex; min-height: 40px; cursor: pointer; align-items: center; gap: 7px; border: 1px solid transparent; border-radius: 9px; padding: 0 13px; background: transparent; color: #475569; }
  .theme-switcher button.active { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; font-weight: 700; }
  .motion-toggle { display: inline-flex; margin-left: auto; align-items: center; gap: 8px; padding: 0 10px; color: #475569; font-size: 13px; }
  .lab-grid { --surface-shell: #f8fafc; --surface-panel: #fff; --surface-raised: #f1f5f9; --surface-text: #0f172a; --surface-muted: #475569; --surface-subtle: #64748b; --surface-border: #cbd5e1; --surface-interactive-border: #64748b; --surface-shadow: 0 16px 50px rgba(15,23,42,.08); display: grid; max-width: 1320px; margin: 0 auto; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; color: var(--surface-text); }
  .lab-grid[data-theme="dark"], .lab-grid[data-theme="workspace"] { --surface-shell: #09090b; --surface-panel: #18181b; --surface-raised: #27272a; --surface-text: #f4f4f5; --surface-muted: #a1a1aa; --surface-subtle: #a1a1aa; --surface-border: #3f3f46; --surface-interactive-border: #71717a; --surface-shadow: 0 20px 60px rgba(0,0,0,.3); }
  .specimen { min-width: 0; border: 1px solid var(--surface-border); border-radius: 16px; padding: 20px; background: var(--surface-shell); box-shadow: var(--surface-shadow); }
  .section-heading { display: flex; margin-bottom: 16px; align-items: start; justify-content: space-between; gap: 12px; }
  .section-heading h2 { margin: 3px 0 0; color: var(--surface-text); font-size: 17px; }
  .badge { border: 1px solid var(--surface-border); border-radius: 999px; padding: 4px 8px; color: var(--surface-muted); font-size: 11px; }
  .badge.violet { border-color: #a78bfa; color: #7c3aed; }
  .popup-frame { max-width: 360px; margin: auto; border: 1px solid var(--surface-border); border-radius: 14px; padding: 14px; background: var(--surface-panel); }
  .popup-heading { display: flex; align-items: center; gap: 10px; }
  .popup-heading > span:nth-child(2) { min-width: 0; flex: 1; }
  strong, small { display: block; }
  small { margin-top: 3px; color: var(--surface-muted); font-size: 12px; }
  .leading-icon { display: inline-flex; width: 38px; height: 38px; flex: 0 0 auto; align-items: center; justify-content: center; border-radius: 10px; background: #ede9fe; color: #6d28d9; }
  .leading-icon.video { background: #fee2e2; color: #b91c1c; }
  .icon-button { display: inline-flex; width: 38px; height: 38px; cursor: pointer; align-items: center; justify-content: center; border: 1px solid var(--surface-interactive-border); border-radius: 9px; background: var(--surface-panel); color: var(--surface-muted); }
  .field-label { display: flex; margin: 15px 0 8px; align-items: center; justify-content: space-between; color: var(--surface-muted); font-size: 12px; font-weight: 700; }
  select, input { min-height: 36px; border: 1px solid var(--surface-interactive-border); border-radius: 8px; padding: 0 9px; background: var(--surface-panel); color: var(--surface-text); }
  .gif-action { display: flex; width: 100%; min-height: 60px; cursor: pointer; align-items: center; gap: 11px; border: 1px solid var(--surface-interactive-border); border-radius: 10px; padding: 11px; background: var(--surface-panel); color: var(--surface-text); text-align: left; transition: border-color 150ms ease, background 150ms ease; }
  .gif-action > span:nth-child(2) { min-width: 0; flex: 1; }
  .gif-action:hover { border-color: #7c3aed; background: color-mix(in srgb, var(--surface-panel) 94%, #7c3aed); }
  .gif-action .leading-icon { width: 34px; height: 34px; border-radius: 8px; background: #ede9fe; color: #6d28d9; }
  .gif-action small { color: var(--surface-muted); }
  .gif-action > :global(svg) { color: #7c3aed; }
  .mode-group { display: grid; margin: 15px 0 10px; grid-template-columns: repeat(3,1fr); gap: 7px; border: 0; padding: 0; }
  .mode-group legend { margin-bottom: 8px; color: var(--surface-muted); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .mode-group button { min-height: 44px; cursor: pointer; border: 1px solid var(--surface-interactive-border); border-radius: 9px; background: var(--surface-panel); color: var(--surface-muted); text-transform: capitalize; }
  .mode-group button.selected { border-color: #2563eb; background: #eff6ff; color: #1d4ed8; font-weight: 700; }
  .lab-grid[data-theme="dark"] .mode-group button.selected, .lab-grid[data-theme="workspace"] .mode-group button.selected { background: #172554; color: #bfdbfe; }
  .primary-action, .danger-action, .gif-solid, .secondary-action { display: inline-flex; min-height: 40px; cursor: pointer; align-items: center; justify-content: center; gap: 8px; border-radius: 9px; padding: 0 13px; font-weight: 700; }
  .primary-action { border: 1px solid #2563eb; background: #2563eb; color: #fff; }
  .popup-frame > .primary-action { width: 100%; }
  .secondary-action { border: 1px solid var(--surface-interactive-border); background: var(--surface-panel); color: var(--surface-text); }
  .danger-action { border: 1px solid #dc2626; background: #dc2626; color: #fff; }
  .gif-solid { border: 1px solid #7c3aed; background: #7c3aed; color: #fff; }
  .state-list { display: grid; gap: 8px; }
  .state-list > div { display: flex; min-height: 54px; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--surface-border); color: var(--surface-muted); font-size: 12px; }
  .state-list > div:last-child { border: 0; }
  .simulated-hover { background: var(--surface-raised); }
  .simulated-focus, button:focus-visible, select:focus-visible, input:focus-visible, a:focus-visible { outline: 3px solid #60a5fa; outline-offset: 2px; }
  button:disabled { cursor: not-allowed; opacity: .55; }
  :global(.spin) { animation: spin .8s linear infinite; }
  .feedback-list { display: grid; gap: 10px; }
  .feedback { display: flex; align-items: start; gap: 10px; border: 1px solid; border-radius: 11px; padding: 12px; }
  .feedback span { min-width: 0; flex: 1; }
  .feedback.info { border-color: #60a5fa; background: #eff6ff; color: #1e40af; }
  .feedback.success { border-color: #34d399; background: #ecfdf5; color: #065f46; }
  .feedback.error { border-color: #f87171; background: #fef2f2; color: #991b1b; }
  .feedback button { min-height: 34px; border: 1px solid currentColor; border-radius: 7px; background: transparent; color: inherit; }
  .lab-grid[data-theme="dark"] .feedback.info, .lab-grid[data-theme="workspace"] .feedback.info { background: #172554; color: #bfdbfe; }
  .lab-grid[data-theme="dark"] .feedback.success, .lab-grid[data-theme="workspace"] .feedback.success { background: #052e2b; color: #a7f3d0; }
  .lab-grid[data-theme="dark"] .feedback.error, .lab-grid[data-theme="workspace"] .feedback.error { background: #450a0a; color: #fecaca; }
  .empty-state { display: grid; place-items: center; border: 1px dashed var(--surface-interactive-border); border-radius: 12px; padding: 24px; color: var(--surface-muted); text-align: center; }
  .empty-state strong { margin-top: 8px; color: var(--surface-text); }
  .empty-state p { margin: 5px 0 14px; font-size: 13px; }
  .recording-row { display: grid; margin-top: 12px; grid-template-columns: 78px minmax(0,1fr) 38px; align-items: center; gap: 11px; border: 1px solid var(--surface-border); border-radius: 12px; padding: 9px; background: var(--surface-panel); }
  .recording-row strong { overflow-wrap: anywhere; font-size: 13px; }
  .fake-thumbnail { display: flex; height: 50px; align-items: end; justify-content: end; border-radius: 7px; padding: 5px; background: linear-gradient(135deg,#1e3a8a,#7c3aed); color: #fff; font-size: 10px; }
  .workspace-preview { grid-column: span 2; background: #09090b; color: #f4f4f5; --surface-text: #f4f4f5; --surface-muted: #a1a1aa; --surface-border: #3f3f46; --surface-panel: #18181b; --surface-interactive-border: #71717a; }
  .workspace-stage { display: grid; min-height: 230px; grid-template-columns: minmax(0,1fr) 250px; overflow: hidden; border: 1px solid #3f3f46; border-radius: 12px; background: #18181b; }
  .canvas-preview { display: flex; align-items: center; justify-content: center; gap: 9px; background: radial-gradient(circle at center,#27272a,#09090b); color: #a1a1aa; }
  .workspace-stage aside { display: grid; align-content: start; gap: 12px; border-left: 1px solid #3f3f46; padding: 16px; }
  .workspace-stage label { display: grid; gap: 5px; color: #a1a1aa; font-size: 12px; }
  .workspace-stage .gif-solid { margin-top: 4px; }
  .recording-status { display: flex; align-items: center; gap: 9px; border: 1px solid #f87171; border-radius: 11px; padding: 13px; background: #fef2f2; color: #991b1b; }
  .recording-status time { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 800; }
  .recording-dot { width: 10px; height: 10px; border-radius: 50%; background: #dc2626; animation: pulse 1.3s ease-in-out infinite; }
  .paired-actions { display: grid; margin-top: 10px; grid-template-columns: 1fr 1fr; gap: 9px; }
  .stop-square { width: 11px; height: 11px; background: currentColor; }
  .reduced-motion *, .reduced-motion *::before, .reduced-motion *::after { scroll-behavior: auto !important; }
  .reduced-motion :global(.spin), .reduced-motion .recording-dot { animation: none; }
  @media (prefers-reduced-motion: reduce) { :global(.spin), .recording-dot { animation: none; } }
  @media (max-width: 820px) { .lab-shell { padding: 18px; } .lab-header { align-items: start; flex-direction: column; } .lab-grid { grid-template-columns: 1fr; } .workspace-preview { grid-column: auto; } .workspace-stage { grid-template-columns: 1fr; } .workspace-stage aside { border-top: 1px solid #3f3f46; border-left: 0; } .motion-toggle { width: 100%; margin: 0; min-height: 38px; } }
  @media (max-width: 420px) { .lab-shell { padding: 10px; } .specimen { padding: 14px; } .theme-switcher { display: grid; grid-template-columns: 1fr; } .theme-switcher button { width: 100%; justify-content: flex-start; } .motion-toggle { width: 100%; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 50% { opacity: .35; } }
</style>
