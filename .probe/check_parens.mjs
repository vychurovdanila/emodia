import fs from 'node:fs';

const text = fs.readFileSync('apps/web/src/screens/EmotionSpace.tsx', 'utf8');
const lines = text.split('\n');

let b = 0, p = 0;
let inString = false, stringChar = '', inTemplate = false;

function keyLines(i) {
  return (i >= 478 && i <= 482) ||
    (i >= 485 && i <= 487) ||
    i === 928 || i === 931 || i === 974 || i === 975 ||
    (i >= 1288 && i <= 1292) ||
    (i >= 1311 && i <= 1314);
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    const prv = j > 0 ? line[j - 1] : '';
    if (c === '\\' && (inString || inTemplate)) { j++; continue; }
    if (c === '`') { inTemplate = !inTemplate; continue; }
    if ((c === '"' || c === "'") && !inTemplate) {
      if (inString && c === stringChar) { inString = false; }
      else if (!inString) { inString = true; stringChar = c; }
      continue;
    }
    if (inString || inTemplate) continue;
    if (c === '{') b++;
    if (c === '}') b--;
    if (c === '(') p++;
    if (c === ')') p--;
  }
  if (keyLines(i)) console.log('After line ' + (i + 1) + ': b=' + b + ' p=' + p + '  ' + line.trim().substring(0, 55));
}

console.log('FINAL: b=' + b + ' p=' + p);

// Show last 20 lines
console.log('\n--- Last 20 lines ---');
for (let i = Math.max(0, lines.length - 20); i < lines.length; i++) {
  console.log('Line ' + (i + 1) + ': ' + JSON.stringify(lines[i]));
}

