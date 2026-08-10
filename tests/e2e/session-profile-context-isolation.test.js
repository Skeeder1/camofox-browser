const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startServer, stopServer, getServerUrl } = require('../helpers/startServer');
const { startTestSite, stopTestSite, getTestSiteUrl } = require('../helpers/testSite');

async function postJson(serverUrl, route, body) {
  const res = await fetch(`${serverUrl}${route}`, {
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
  const res = await fetch(`${serverUrl}/sessions/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { res, data };
}

function encodeKeyComponent(value) {
  return Buffer.from(String(value), 'utf16le').toString('base64url');
}

describe('Session profile context isolation', () => {
  let serverUrl;
  let testSiteUrl;
  let tempRoot;
  let profilesDir;
  const cleanupUsers = new Set();

  function trackUser(prefix) {
    const userId = `${prefix}-${crypto.randomUUID()}`;
    cleanupUsers.add(userId);
    return userId;
  }

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camofox-profile-isolation-'));
    profilesDir = path.join(tempRoot, 'profiles');

    await startServer(0, {
      CAMOFOX_API_KEY: '',
      CAMOFOX_MAX_SESSIONS: '2',
      CAMOFOX_PROFILES_DIR: profilesDir,
      CAMOFOX_DOWNLOADS_DIR: path.join(tempRoot, 'downloads'),
      CAMOFOX_COOKIES_DIR: path.join(tempRoot, 'cookies'),
    });
    serverUrl = getServerUrl();
    await startTestSite();
    testSiteUrl = getTestSiteUrl();
  }, 120000);

  afterEach(async () => {
    for (const userId of cleanupUsers) {
      await deleteSession(serverUrl, userId).catch(() => {});
    }
    cleanupUsers.clear();
  }, 30000);

  afterAll(async () => {
    await stopTestSite();
    await stopServer();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30000);

  test('same user can keep sibling session-profile contexts in separate persistent profiles', async () => {
    const userId = trackUser('profile-sibling');

    const alpha = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'alpha',
      url: `${testSiteUrl}/pageA`,
      geoMode: 'explicit-wins',
    });
    expect(alpha.res.status).toBe(200);
    expect(alpha.data.tabId).toBeDefined();

    const beta = await postJson(serverUrl, '/tabs', {
      userId,
      sessionKey: 'beta',
      url: `${testSiteUrl}/pageB`,
      geoMode: 'explicit-wins',
    });
    expect(beta.res.status).toBe(200);
    expect(beta.data.tabId).toBeDefined();

    const profileDirs = fs
      .readdirSync(profilesDir)
      .map((entry) => decodeURIComponent(entry))
      .filter((entry) => entry.startsWith(`p:${encodeKeyComponent(userId)}:`));
    expect(profileDirs).toHaveLength(2);
    expect(profileDirs.some((entry) => entry.includes(`:${encodeKeyComponent('alpha')}:`))).toBe(true);
    expect(profileDirs.some((entry) => entry.includes(`:${encodeKeyComponent('beta')}:`))).toBe(true);
  }, 120000);
});
