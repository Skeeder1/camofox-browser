const { getSession, closeSessionsForUser } = require('../../dist/src/services/session');
const { acquirePageForNewTab } = require('../../dist/src/services/tab');

async function main() {
  const userId = `initial-blank-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const session = await getSession(userId, null, 'default');

  try {
    const beforePages = session.context.pages();
    const beforeUrls = beforePages.map((page) => page.url());
    const page = await acquirePageForNewTab(session.context);

    await page.goto('data:text/html,<title>Issue 19</title><h1>Issue 19</h1>');

    const afterPages = session.context.pages();
    const afterUrls = afterPages.map((openPage) => openPage.url());

    console.log(`__PROBE__${JSON.stringify({
      beforeUrls,
      reusedInitialPage: page === beforePages[0],
      afterUrls,
    })}`);
  } finally {
    await closeSessionsForUser(userId);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
