// Thin entry point: wires real dependencies into the tested main().
import { main } from '../src/cli.ts';
import { fetchGet } from '../src/telemetry/github.ts';

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  now: Date.now,
  http: fetchGet,
  log: (line) => console.log(line),
  cwd: process.cwd(),
});
