// Fails while placeholder content would ship. Run before pointing DNS at the site.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const problems = [];

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

for (const file of ['src/config/site.ts', ...walk('src/pages'), ...walk('src/content')]) {
  const text = readFileSync(file, 'utf8');
  const isDraft = /^draft:\s*true/m.test(text);
  if (isDraft) continue; // drafts never reach production
  text.split('\n').forEach((line, i) => {
    if (/\bTODO\b/.test(line)) problems.push(`${file}:${i + 1}  ${line.trim()}`);
  });
}

if (readFileSync('src/config/site.ts', 'utf8').includes("'https://example.com'")) {
  problems.push('src/config/site.ts  site.url is still https://example.com');
}
if (!process.env.PUBLIC_WEB3FORMS_KEY && !/WEB3FORMS_KEY = '[0-9a-f-]{36}'/.test(readFileSync('src/config/forms.ts', 'utf8'))) {
  problems.push('src/config/forms.ts  no Web3Forms access key (set WEB3FORMS_KEY or PUBLIC_WEB3FORMS_KEY)');
}

if (problems.length) {
  console.error(`Not ready to launch (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('Ready to launch.');
