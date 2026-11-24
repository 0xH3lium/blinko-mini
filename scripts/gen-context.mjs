import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const exts = ['ts', 'tsx', 'js', 'mjs', 'css', 'sql', 'json', 'html', 'yml', 'yaml', 'md'];
const patterns = exts.map(e => `*.${e}`);
const tracked = execFileSync('git', ['ls-files', ...patterns], { encoding: 'utf8' });
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', ...patterns], { encoding: 'utf8' });
const files = [...new Set([tracked, untracked].join('\n').split('\n'))]
  .filter(f => f && existsSync(f) && !['pnpm-lock.yaml', 'CONTEXT.md'].includes(f))
  .sort();

const ctx = files.map(f => `## ${f}\n\`\`\`\`${f.split('.').pop()}\n${readFileSync(f, 'utf8')}\n\`\`\`\`\n`).join('\n');
writeFileSync('CONTEXT.md', ctx);
console.log(`CONTEXT.md: ${files.length} files`);
