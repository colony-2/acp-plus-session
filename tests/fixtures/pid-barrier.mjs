import { writeFile } from 'node:fs/promises';
import { publishPid } from './pid-readiness.mjs';
const [mode, path, initial = 'empty'] = process.argv.slice(2);
function release() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Publisher barrier timed out')), 3000);
    process.once('message', () => { clearTimeout(timer); resolve(); });
  });
}
async function barrier(stage, temporary) {
  const next = release();
  process.send({ stage, temporary, pid: process.pid });
  await next;
}
await release();
if (mode === 'atomic') {
  await publishPid(path, process.pid, { onStage: barrier });
} else {
  const digits = String(process.pid);
  for (const stage of ['empty', 'partial', 'unterminated'].slice(['empty', 'partial', 'unterminated'].indexOf(initial))) {
    await writeFile(path, stage === 'empty' ? '' : stage === 'partial' ? digits.slice(0, -1) : digits);
    await barrier(stage);
  }
  await writeFile(path, digits + '\n');
}
process.send({ stage: 'done', pid: process.pid });
process.disconnect();
