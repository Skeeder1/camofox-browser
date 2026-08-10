const fs = require('node:fs');
const path = require('node:path');

describe('Package release contract', () => {
  test('pins playwright-core to the Camoufox-compatible protocol version', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
    );

    expect(packageJson.dependencies['playwright-core']).toBe('1.58.1');
  });
});
