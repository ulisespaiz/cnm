// Fails while placeholder content would ship (TODO) or an answer from the owner is still
// outstanding (CONFIRM). Run before pointing DNS at the site.
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
    if (/\b(?:TODO|CONFIRM)\b/.test(line)) problems.push(`${file}:${i + 1}  ${line.trim()}`);
  });
}

if (readFileSync('src/config/site.ts', 'utf8').includes("'https://example.com'")) {
  problems.push('src/config/site.ts  site.url is still https://example.com');
}
if (!process.env.PUBLIC_WEB3FORMS_KEY && !/WEB3FORMS_KEY = '[0-9a-f-]{36}'/.test(readFileSync('src/config/forms.ts', 'utf8'))) {
  problems.push('src/config/forms.ts  no Web3Forms access key (set WEB3FORMS_KEY or PUBLIC_WEB3FORMS_KEY)');
}

// Not blockers, but work the owner still has to do: counted here so "Ready to launch" is not read as "finished".
// The script only reads files; it changes nothing and never affects the exit code.
const notes = [];
try {
  const parts = JSON.parse(readFileSync('src/content/parts.json', 'utf8'));
  const verify = parts.filter((p) => p.oemVerify).length;
  const flagged = parts.filter((p) => Array.isArray(p.flags) ? p.flags.length : p.flags).length;
  const noImage = parts.filter((p) => !p.images?.length).length;
  if (verify) notes.push(`${verify} of ${parts.length} parts have oemVerify: true (the owner confirms those OEM numbers)`);
  if (flagged) notes.push(`${flagged} parts carry owner flags in src/content/parts.json (data-quality notes, never shown)`);
  if (noImage) notes.push(`${noImage} parts have no photo`);
} catch {
  // no catalog to count
}
const drafts = walk('src/content').filter((f) => f.includes('areas') && /^draft:\s*true/m.test(readFileSync(f, 'utf8')));
if (drafts.length) notes.push(`${drafts.length} service-area pages are still drafts and are not published`);
const social = /social:\s*\{([^}]*)\}/s.exec(readFileSync('src/config/site.ts', 'utf8'))?.[1] ?? '';
const emptySocial = [...social.matchAll(/(\w+):\s*''/g)].map((m) => m[1]);
if (emptySocial.length) notes.push(`empty social links: ${emptySocial.join(', ')}`);
const info = () => {
  if (notes.length) console.log(`\nStill for the owner (not counted above):\n${notes.map((n) => `  - ${n}`).join('\n')}`);
};

if (problems.length) {
  console.error(`Not ready to launch (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  info();
  process.exit(1);
}
console.log('Ready to launch.');
info();
