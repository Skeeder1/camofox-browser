const crypto = require('crypto');

const { startServer, stopServer, getServerUrl } = require('../helpers/startServer');
const { startTestSite, stopTestSite, getTestSiteUrl } = require('../helpers/testSite');

async function postJson(serverUrl, path, body) {
  const res = await fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { res, data };
}

async function deleteSession(serverUrl, userId) {
  await fetch(`${serverUrl}/sessions/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  }).catch(() => {});
}

describe('Cookie import session targeting', () => {
  let serverUrl;
  let testSiteUrl;
  const cleanupUsers = new Set();

  function trackUser(prefix) {
    const userId = `${prefix}-${crypto.randomUUID()}`;
    cleanupUsers.add(userId);
    return userId;
  }

  beforeAll(async () => {
    await startServer(0, { CAMOFOX_MAX_SESSIONS: '2', CAMOFOX_API_KEY: '' });
    serverUrl = getServerUrl();
    await startTestSite();
    testSiteUrl = getTestSiteUrl();
  }, 120000);

  afterEach(async () => {
    for (const userId of cleanupUsers) {
      await deleteSession(serverUrl, userId);
    }
    cleanupUsers.clear();
  });

  afterAll(async () => {
    await stopTestSite();
    await stopServer();
  }, 30000);

  test('cookie import without tabId rejects ambiguous sibling profile sessions', async () => {
    const userId = trackUser('cookie-ambiguous');
    const profileOverrides = {
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { latitude: 40.7128, longitude: -74.006 },
      geoMode: 'explicit-wins',
    };

    const first = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'alpha',
      url: `${testSiteUrl}/pageA`,
      ...profileOverrides,
    });
    expect(first.res.status).toBe(200);

    const second = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'beta',
      url: `${testSiteUrl}/pageB`,
      ...profileOverrides,
    });
    expect(second.res.status).toBe(200);

    const ambiguous = await postJson(serverUrl, `/sessions/${encodeURIComponent(userId)}/cookies`, {
      cookies: [{ name: 'session', value: '1', domain: '.example.com', path: '/' }],
    });
    expect(ambiguous.res.status).toBe(409);
    expect(ambiguous.data.error).toBe('Ambiguous active sessions');

    const targeted = await postJson(serverUrl, `/sessions/${encodeURIComponent(userId)}/cookies`, {
      tabId: second.data.tabId,
      cookies: [{ name: 'session', value: '2', domain: '.example.com', path: '/' }],
    });
    expect(targeted.res.status).toBe(200);
    expect(targeted.data.count).toBe(1);
  }, 30000);
});
