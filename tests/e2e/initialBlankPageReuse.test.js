const path = require('path');
const { spawnSync } = require('child_process');

describe('Initial blank page reuse', () => {
  test('first managed tab reuses the persistent context blank page', async () => {
    const probePath = path.join(__dirname, '../helpers/initialBlankPageReuseProbe.js');
    const result = spawnSync(process.execPath, [probePath], {
      cwd: path.join(__dirname, '../..'),
      encoding: 'utf8',
      timeout: 120000,
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `Probe exited with status ${result.status}`);
    }

    const jsonLine = result.stdout
      .trim()
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.startsWith('__PROBE__'));
    expect(jsonLine).toBeDefined();

    const probe = JSON.parse(jsonLine.slice('__PROBE__'.length));
    expect(probe.beforeUrls).toEqual(['about:blank']);
    expect(probe.reusedInitialPage).toBe(true);
    expect(probe.afterUrls).toHaveLength(1);
    expect(probe.afterUrls[0]).toContain('Issue 19');
  }, 120000);
});
