import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const exts = ['ts', 'tsx', 'js', 'mjs', 'css', 'sql', 'json', 'html', 'yml', 'yaml', 'md'];
const files = execFileSync('git', ['ls-files', ...exts.map(e => `*.${e}`)], { encoding: 'utf8' })
  .trim().split('\n').filter(f => f && existsSync(f) && !['pnpm-lock.yaml', 'CONTEXT.md'].includes(f));

const ctx = files.map(f => `## ${f}\n\`\`\`\`${f.split('.').pop()}\n${readFileSync(f, 'utf8')}\n\`\`\`\`\n`).join('\n');
writeFileSync('CONTEXT.md', ctx);
console.log(`CONTEXT.md: ${files.length} files`);
