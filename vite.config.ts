import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/** "branch @ sha" so a phone tester can tell which deploy they're looking at. */
function buildLabel(): string {
  // Cloudflare Pages sets these; locally, ask git.
  const git = (args: string): string => {
    try {
      return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  };
  const branch = process.env.CF_PAGES_BRANCH ?? git('rev-parse --abbrev-ref HEAD');
  const sha = (process.env.CF_PAGES_COMMIT_SHA ?? git('rev-parse HEAD')).slice(0, 7);
  return `${branch} @ ${sha}`;
}

export default defineConfig({
  define: {
    __BUILD_LABEL__: JSON.stringify(buildLabel()),
  },
  build: {
    target: 'es2022',
    // Phaser alone is ~1.5 MB minified, and the siege's physics engine (Rapier, its wasm inlined)
    // ~4.4 MB, loaded only with the siege: that's expected, not a regression.
    chunkSizeWarningLimit: 4500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
