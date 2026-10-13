import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// IndexNow wiring, checked as data (no browser, and nothing here runs scripts/indexnow.mjs or touches the
// network): the key file and the site config agree, the file is in the build, the npm script exists, and
// the CI step sits after the deploy step in the deploy job, is best-effort, and is not in the build job
// or in any test script.

const config = readFileSync('src/config/site.ts', 'utf8');
const key = /^\s*indexNowKey:\s*'([^']*)'/m.exec(config)?.[1] ?? '';
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
// The workflow without its comment lines
const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

test.describe('IndexNow', () => {
  test('the key is 32 hex characters and public/<key>.txt holds exactly that key', () => {
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(existsSync(`public/${key}.txt`)).toBe(true);
    expect(readFileSync(`public/${key}.txt`, 'utf8').trim()).toBe(key);
  });

  test('the key file is part of the build, with the shop on or off', () => {
    expect(readFileSync(`dist/${key}.txt`, 'utf8').trim()).toBe(key);
  });

  test('npm run indexnow exists, and no test script runs it', () => {
    expect(pkg.scripts.indexnow).toBe('node scripts/indexnow.mjs');
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (name === 'indexnow') continue;
      expect(command, `script "${name}"`).not.toMatch(/indexnow/i);
    }
    expect(Object.keys(pkg.scripts).filter((n) => /^(pre|post)indexnow$/.test(n))).toEqual([]);
  });

  test('the script posts host, key, keyLocation and urlList (at most 10000) to the IndexNow API, and never runs in a test', () => {
    const script = readFileSync('scripts/indexnow.mjs', 'utf8');
    expect(script).toContain('https://api.indexnow.org/indexnow');
    expect(script).toMatch(/MAX_URLS\s*=\s*10000/);
    for (const field of ['host', 'key', 'keyLocation', 'urlList']) expect(script).toContain(field);
    expect(script).toContain('TEST_WORKER_INDEX');
  });

  test('CI runs it once, after the deploy step in the deploy job, as a best-effort step', () => {
    const deployAt = ci.indexOf('\n  deploy:');
    expect(deployAt).toBeGreaterThan(0);
    const buildJob = ci.slice(0, deployAt);
    const deployJob = ci.slice(deployAt);
    expect(buildJob).not.toMatch(/indexnow/i);
    expect(ci.match(/npm run indexnow/g)).toHaveLength(1);

    const deployStep = deployJob.indexOf('cloudflare/wrangler-action');
    const step = deployJob.indexOf('npm run indexnow');
    expect(deployStep).toBeGreaterThan(0);
    expect(step, 'after the deploy step').toBeGreaterThan(deployStep);
    // the step's own lines: from its "- name:" line to the end of the file or the next step
    const from = deployJob.lastIndexOf('\n      - ', step);
    const block = deployJob.slice(from, step + 'npm run indexnow'.length);
    expect(block).toMatch(/continue-on-error:\s*true/);
    expect(block).toMatch(/CLOUDFLARE_API_TOKEN/); // only where the deploy ran
  });
});
