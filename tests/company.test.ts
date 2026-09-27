import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCENARIOS } from '../company/testing/scenarios.js';
import { JsonStore } from '../memory/store.js';

// Every AI-employee certification scenario is also a CI test, so the quality contract is enforced on every change.
describe('AI employee certification scenarios', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.employee} ${sc.level}: ${sc.name}`, async () => {
      const evidence = await sc.run();
      expect(Array.isArray(evidence)).toBe(true);
    });
  }
});

describe('regression: unreadable data file is never silently replaced', () => {
  it('load() throws on corrupt JSON instead of returning empty state', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'tw01-')), 'state.json');
    writeFileSync(f, '{"leads": [ broken');
    let msg = '';
    try { await new JsonStore(f).load(); } catch (e) { msg = (e as Error).message; }
    expect(msg.includes('Refusing to start with empty state')).toBe(true);
  });
});
