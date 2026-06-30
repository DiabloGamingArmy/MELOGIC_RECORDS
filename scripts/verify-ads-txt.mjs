import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const expected = 'google.com, pub-REPLACE_WITH_MY_REAL_PUBLISHER_ID, DIRECT, f08c47fec0942fa0';
const files = [
  ['public/ads.txt', resolve('public/ads.txt')],
  ['dist/ads.txt', resolve('dist/ads.txt')],
];

for (const [label, filePath] of files) {
  let firstLine;

  try {
    firstLine = readFileSync(filePath, 'utf8').split(/\r?\n/, 1)[0];
  } catch (error) {
    console.error(`Missing ${label}. Run npm run build and try again.`);
    process.exit(1);
  }

  if (firstLine !== expected) {
    console.error(`${label} does not match the expected ads.txt line.`);
    process.exit(1);
  }
}

console.log(`dist/ads.txt: ${expected}`);
