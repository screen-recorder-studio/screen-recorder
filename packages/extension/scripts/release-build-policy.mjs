const CONSOLE_METHODS = [
  'console.log',
  'console.debug',
  'console.info',
  'console.trace',
  'console.warn',
  'console.error',
  'console.time',
  'console.timeEnd'
]

const RELEASE_CONSOLE_NOOP = '__SCREEN_RECORDER_RELEASE_CONSOLE_NOOP__'
const RELEASE_CONSOLE_BANNER = `var ${RELEASE_CONSOLE_NOOP}=()=>{};`

/**
 * @typedef {object} ReleaseBuildPolicy
 * @property {boolean} debugLogs
 * @property {false | 'esbuild'} minify
 * @property {NonNullable<import('vite').UserConfig['esbuild']> | undefined} esbuild
 * @property {Record<string, string> | undefined} define
 * @property {string | undefined} rollupBanner
 */

/**
 * @param {{ debugLogs?: boolean }} [options]
 * @returns {ReleaseBuildPolicy}
 */
export function createReleaseBuildPolicy(options = {}) {
  const debugLogs = options.debugLogs === true

  if (debugLogs) {
    return {
      debugLogs,
      minify: false,
      esbuild: undefined,
      define: undefined,
      rollupBanner: undefined
    }
  }

  return {
    debugLogs,
    minify: 'esbuild',
    esbuild: {
      drop: ['debugger'],
      pure: [RELEASE_CONSOLE_NOOP]
    },
    define: Object.fromEntries(CONSOLE_METHODS.map(method => [method, RELEASE_CONSOLE_NOOP])),
    rollupBanner: RELEASE_CONSOLE_BANNER
  }
}

export function isDebugLoggingBuild(argv = process.argv) {
  return argv.includes('--debug-logs')
}
