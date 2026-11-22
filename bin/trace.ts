// Thin entry point for the traceability check.
import { runTrace } from '../src/trace/run.ts';

process.exitCode = runTrace(process.cwd(), (line) => console.log(line));
