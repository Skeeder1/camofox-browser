const express = require('express');

const coreRoutes = require('../../dist/src/routes/core').default;
const { closeAllSessions, clearAllState } = require('../../dist/src/services/session');
const { contextPool } = require('../../dist/src/services/context-pool');

async function postJson(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CAMOFOX_API_KEY ? { Authorization: `Bearer ${process.env.CAMOFOX_API_KEY}` } : {}),
    },
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

async function main() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(coreRoutes);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const userId = `passive-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    // Test 1: Original passive eviction test - backward compatible (no session profile)
    const established = await postJson(baseUrl, '/tabs', {
      userId,
      sessionKey: 'default',
      viewport: { width: 1111, height: 777 },
    });
    if (established.res.status !== 200) {
      throw new Error(`establish failed: ${established.res.status} ${JSON.stringify(established.data)}`);
    }

    // Evict using userId as profileKey (backward compat)
    contextPool.notifyEviction(userId);
    await contextPool.closeContextByUserId(userId);

    const rebuilt = await postJson(baseUrl, '/tabs', {
      userId,
      sessionKey: 'rebuilt',
    });
    if (rebuilt.res.status !== 200) {
      throw new Error(`rebuild failed: ${rebuilt.res.status} ${JSON.stringify(rebuilt.data)}`);
    }

    const equivalent = await postJson(baseUrl, '/tabs', {
      userId,
      sessionKey: 'equivalent',
      viewport: { width: 1111, height: 777 },
    });
    if (equivalent.res.status !== 200) {
      throw new Error(`equivalent failed: ${equivalent.res.status} ${JSON.stringify(equivalent.data)}`);
    }

    // Test 2: Sibling session keys still share the canonical profile when no proxy profile is requested.
    const siblingUserId = `passive-sibling-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    
    const first = await postJson(baseUrl, '/tabs', {
      userId: siblingUserId,
      sessionKey: 'alpha',
    });
    if (first.res.status !== 200) {
      throw new Error(`alpha session failed: ${first.res.status} ${JSON.stringify(first.data)}`);
    }

    const second = await postJson(baseUrl, '/tabs', {
      userId: siblingUserId,
      sessionKey: 'beta',
    });
    if (second.res.status !== 200) {
      throw new Error(`beta session failed: ${second.res.status} ${JSON.stringify(second.data)}`);
    }

    contextPool.notifyEviction(siblingUserId);
    await contextPool.closeContextByUserId(siblingUserId);

    // The canonical profile should rebuild after passive eviction.
    const afterEviction = await postJson(baseUrl, '/tabs', {
      userId: siblingUserId,
      sessionKey: 'beta',
    });
    if (afterEviction.res.status !== 200) {
      throw new Error(`beta session after passive eviction failed: ${afterEviction.res.status} ${JSON.stringify(afterEviction.data)}`);
    }

    process.stdout.write('PASS passive-session-invariant\n');
  } finally {
    await closeAllSessions().catch(() => {});
    clearAllState();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
