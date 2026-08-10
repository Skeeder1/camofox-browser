const http = require('http');
const crypto = require('crypto');

let mockServer;
let mockPort;
let lastAuthHeader = null;

beforeAll(async () => {
  await new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      lastAuthHeader = req.headers['authorization'] || null;

      if (req.method === 'POST' && req.url && req.url.includes('/cookies')) {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, userId: 'test-user', count: 1 }));
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    mockServer.listen(0, () => {
      mockPort = mockServer.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (mockServer) {
    await new Promise((resolve) => mockServer.close(resolve));
  }
});

beforeEach(() => {
  lastAuthHeader = null;
});

// Simulate plugin fetchApi behavior from plugin.ts.
async function pluginFetchApi(baseUrl, path, options = {}, apiKey = undefined) {
  const url = `${baseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }

  return res.json();
}

describe('Plugin cookie-import no-key regression', () => {
  test('cookie import succeeds WITHOUT CAMOFOX_API_KEY (no throw, no auth header)', async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    const userId = `test-${crypto.randomUUID()}`;
    const cookies = [{ name: 'a', value: '1', domain: '.example.com', path: '/' }];

    // This is the code path that used to throw locally when no API key was configured.
    const result = await pluginFetchApi(
      baseUrl,
      `/sessions/${encodeURIComponent(userId)}/cookies`,
      { method: 'POST', body: JSON.stringify({ cookies }) },
      undefined
    );

    expect(result.ok).toBe(true);
    expect(lastAuthHeader).toBeNull();
  });

  test('cookie import attaches bearer header WITH CAMOFOX_API_KEY', async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    const userId = `test-${crypto.randomUUID()}`;
    const cookies = [{ name: 'b', value: '2', domain: '.example.com', path: '/' }];
    const apiKey = `test-key-${crypto.randomUUID()}`;

    const result = await pluginFetchApi(
      baseUrl,
      `/sessions/${encodeURIComponent(userId)}/cookies`,
      { method: 'POST', body: JSON.stringify({ cookies }) },
      apiKey
    );

    expect(result.ok).toBe(true);
    expect(lastAuthHeader).toBe(`Bearer ${apiKey}`);
  });
});