import { toCode, type ExportTarget } from '@/core/export';
import { CASES } from './export-cases';

const TARGETS: ExportTarget[] = [
  'selenium-py', 'selenium-java', 'css', 'json',
];

const out: Record<string, Record<string, string>> = {};
for (const target of TARGETS) {
  out[target] = {};
  for (const [name, pick] of CASES) out[target]![name] = toCode(pick, target);
}
process.stdout.write(JSON.stringify(out));
