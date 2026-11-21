import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForPid, pidAbsent } from '../../tests/fixtures/pid-readiness.mjs';
const fixtureImport = `import { publishPid, waitForPid } from ${JSON.stringify(new URL('../../tests/fixtures/pid-readiness.mjs', import.meta.url).href)};`;

// Adversarial local tool fixture. It leaves a detached, TERM-ignoring writer
// holding the tool's pipes after its leader exits. Never used by product code.
export async function writerFixture(workspace: string) {
  await mkdir(workspace, { recursive: true });
  const ready = join(workspace, 'writer-ready'), marker = join(workspace, 'writer-marker');
  const writer = join(workspace, 'writer.mjs'), leader = join(workspace, 'leader.mjs');
  await writeFile(writer, `${fixtureImport}import fs from 'node:fs'; process.on('SIGTERM',()=>{}); fs.appendFileSync(${JSON.stringify(marker)},'x'); setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),10); await publishPid(${JSON.stringify(ready)});`);
  await writeFile(leader, `${fixtureImport}import{spawn}from'node:child_process';const child=spawn(process.execPath,[${JSON.stringify(writer)}],{detached:true,stdio:'inherit'});child.unref();const timer=setInterval(()=>{},10);await waitForPid(${JSON.stringify(ready)});clearInterval(timer);process.stdout.write('detached fixture started\\n');process.exit(0);`);
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  return {
    command: `${quote(process.execPath)} ${quote(leader)}`,
    async inspect() {
      const pid = await waitForPid(ready);
      const reaped = pidAbsent(pid);
      const bytes = (await stat(marker)).size; await delay(150);
      return { pid, reaped, bytesAfterExit: bytes, stableAfterExit: bytes === (await stat(marker)).size };
    }
  };
}
