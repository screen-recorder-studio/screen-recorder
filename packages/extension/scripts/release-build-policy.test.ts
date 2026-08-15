import { describe, expect, it } from 'vitest'
import { transform } from 'esbuild'
import { createReleaseBuildPolicy } from './release-build-policy.mjs'

describe('release build logging policy', () => {
  it('removes all console calls and debugger statements from release bundles', () => {
    expect(createReleaseBuildPolicy({ debugLogs: false })).toEqual({
      debugLogs: false,
      minify: 'esbuild',
      esbuild: {
        drop: ['debugger'],
        pure: ['__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__']
      },
      define: {
        'console.log': '__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__',
        'console.debug': '__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__',
        'console.info': '__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__',
        'console.trace': '__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__',
        'console.warn': '__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__',
        'console.error': '__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__',
        'console.time': '__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__',
        'console.timeEnd': '__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__'
      },
      rollupBanner: 'var __SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__=()=>{};'
    })
  })

  it('keeps readable code and verbose diagnostics in an explicit debug build', () => {
    expect(createReleaseBuildPolicy({ debugLogs: true })).toEqual({
      debugLogs: true,
      minify: false,
      esbuild: undefined,
      define: undefined,
      rollupBanner: undefined
    })
  })

  it('removes direct and returned console references while preserving argument side effects', async () => {
    const policy = createReleaseBuildPolicy({ debugLogs: false })
    const result = await transform(`
      let sideEffects = 0
      console.log('direct', sideEffects += 1)
      console.time('timer')
      const report = error => console.error('returned', error, sideEffects += 1)
      report(new Error('expected'))
      console.timeEnd('timer')
      globalThis.__releasePolicySideEffects = sideEffects
    `, {
      minify: true,
      define: policy.define,
      pure: policy.esbuild?.pure,
      drop: policy.esbuild?.drop,
      banner: policy.rollupBanner
    })

    expect(result.code).not.toMatch(/console\.(?:log|debug|info|trace|warn|error|time|timeEnd)/)
    Function(result.code)()
    expect(globalThis.__releasePolicySideEffects).toBe(2)
    delete globalThis.__releasePolicySideEffects
  })
})
