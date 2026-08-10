const fs = require('node:fs');
const path = require('node:path');

describe('Docker release contract', () => {
  test('Dockerfile tolerates Camoufox fetch failures during image build', () => {
    const dockerfile = fs.readFileSync(
      path.join(__dirname, '../../Dockerfile'),
      'utf8',
    );

    expect(dockerfile).toContain('RUN npx --yes camoufox-js fetch || true');
  });
});
