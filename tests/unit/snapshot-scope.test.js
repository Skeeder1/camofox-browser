/**
 * Scoped snapshots: role filtering and the POST /tabs/:id/snapshot contract.
 *
 * Regression context: the MCP layer has always sent focusSelector / rolesFilter
 * / maxLines in a POST body, but the browser server only exposed a GET route
 * with no filtering support. Every scoped call died with
 * "Cannot POST /tabs/<id>/snapshot" — i.e. the documented way to shrink an
 * accessibility tree for an LLM (13k+ tokens on a French marketplace page)
 * was unusable.
 */
const { filterSnapshotByRoles } = require('../../dist/src/services/tab.js');

const SAMPLE = [
  '- navigation "Menu":',
  '  - list:',
  '    - listitem:',
  '      - link "Accueil" [e1]:',
  '        - /url: /',
  '      - link "Recherche" [e2]:',
  '- main:',
  '  - heading "Résultats" [level=1]',
  '  - text: 45 522 annonces',
  '  - list:',
  '    - listitem:',
  '      - link "Annonce A" [e3]:',
  '        - /url: /a',
  '      - paragraph:',
  '        - text: "Prix: 170 €."',
  '- dialog [e9]:',
  '  - button "Accepter" [e10]',
].join('\n');

describe('filterSnapshotByRoles', () => {
  test('keeps matching lines and their ancestor chain', () => {
    const out = filterSnapshotByRoles(SAMPLE, ['button']);
    expect(out).toContain('button "Accepter" [e10]');
    expect(out).toContain('- dialog [e9]:');
    // Unrelated siblings are dropped.
    expect(out).not.toContain('heading "Résultats"');
  });

  test('preserves structural ancestors so refs stay resolvable', () => {
    const out = filterSnapshotByRoles(SAMPLE, ['link']);
    const lines = out.split('\n');
    const linkIndex = lines.findIndex((l) => l.includes('link "Annonce A"'));
    expect(linkIndex).toBeGreaterThan(-1);
    // Every link must still sit under its original parent chain.
    expect(out).toContain('- main:');
    expect(out).toMatch(/-\s+list:/);
  });

  test('is case-insensitive and tolerates whitespace', () => {
    const out = filterSnapshotByRoles(SAMPLE, ['  BUTTON  ']);
    expect(out).toContain('button "Accepter"');
  });

  test('returns the input untouched when no roles are requested', () => {
    expect(filterSnapshotByRoles(SAMPLE, [])).toBe(SAMPLE);
  });

  test('drops non-matching subtrees entirely', () => {
    const out = filterSnapshotByRoles(SAMPLE, ['heading']);
    expect(out).toContain('heading "Résultats"');
    expect(out).not.toContain('Annonce A');
    expect(out).not.toContain('Accepter');
  });
});
