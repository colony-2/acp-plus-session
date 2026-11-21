import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Adversarial local tool fixture. It leaves a detached, TERM-ignoring writer
// holding the tool's pipes after its leader exits. Never used by product code.
export async function writerFixture(workspace: string) {
  await mkdir(workspace, { recursive: true });
  const ready = join(workspace, 'writer-ready'), marker = join(workspace, 'writer-marker');
  const writer = join(workspace, 'writer.mjs'), leader = join(workspace, 'leader.mjs');
  await writeFile(writer, `import fs from 'node:fs'; process.on('SIGTERM',()=>{}); fs.appendFileSync(${JSON.stringify(marker)},'x'); fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)); setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),10);`);
  await writeFile(leader, `import{spawn}from'node:child_process';import fs from'node:fs';const child=spawn(process.execPath,[${JSON.stringify(writer)}],{detached:true,stdio:'inherit'});child.unref();setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){process.stdout.write('detached fixture started\\n');process.exit(0)}},10);`);
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  return {
    command: `${quote(process.execPath)} ${quote(leader)}`,
    async inspect() {
      const pid = Number(await readFile(ready, 'utf8'));
      let reaped = false;
      try { process.kill(pid, 0); } catch (error: any) { if (error.code !== 'ESRCH') throw error; reaped = true; }
      const bytes = (await stat(marker)).size; await delay(150);
      return { pid, reaped, bytesAfterExit: bytes, stableAfterExit: bytes === (await stat(marker)).size };
    }
  };
}
