import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'server/dist/db/schema.sql');

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(resolve(root, 'server/src/db/schema.sql'), destination);
console.log('Copied schema.sql into server/dist/db/');
