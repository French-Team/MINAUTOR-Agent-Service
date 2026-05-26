const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'src', 'load-tests.ts');
let c = fs.readFileSync(p, 'utf8');

// Insert fuzzing agents function before "// ── Benchmarks additionnels"
var marker = '// \u2500\u2500 Benchmarks additionnels';
var idx = c.indexOf(marker);
if (idx === -1) throw new Error('Marker not found');

var header = '// \u2500\u2500 Tests de charge 11 : Fuzzing agents .ts corrompus \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n';
var fuzzFunc = 'async function loadTestFuzzingAgents() {\n'
  + "  process.stdout.write(`\\n${BOLD}\\u2500\\u2500 Fuzzing Agents \\u2014 100 fichiers .ts corrompus${RESET}\\n`)\n"
  + "  const agentsDir = join(process.cwd(), '.agents')\n"
  + "  const fs = await import('fs')\n"
  + "  const path = await import('path')\n"
  + '  const backup = new Map<string, string | null>()\n'
  + "  if (fs.existsSync(agentsDir)) {\n"
  + "    for (const f of fs.readdirSync(agentsDir)) {\n"
  + "      if (f.endsWith('.ts') || f.endsWith('.json')) {\n"
  + "        backup.set(f, fs.readFileSync(path.join(agentsDir, f), 'utf-8'))\n"
  + "      }\n"
  + "    }\n"
  + "  }\n"
  + '  const testFiles: string[] = []\n'
  + '\n'
  + "  async function testAgentFile(label: string, content: string | Buffer) {\n"
  + "    const filename = `fuzz-ts-${testFiles.length}-${Date.now()}.ts`\n"
  + "    testFiles.push(filename)\n"
  + "    const filePath = path.join(agentsDir, filename)\n"
  + "    try {\n"
  + "      if (typeof content === 'string') {\n"
  + "        fs.writeFileSync(filePath, content, 'utf-8')\n"
  + "      } else {\n"
  + "        fs.writeFileSync(filePath, content)\n"
  + "      }\n"
  + "      let listOk = true\n"
  + "      try {\n"
  + "        listLocalAgents()\n"
  + "      } catch (e) {\n"
  + "        listOk = false\n"
  + "        assert(`${label} \\u2192 listLocalAgents crash`, false, (e as Error).message)\n"
  + "      }\n"
  + "      let readOk = true\n"
  + "      try {\n"
  + "        readLocalAgent(filename)\n"
  + "      } catch (e) {\n"
  + "        readOk = false\n"
  + "        assert(`${label} \\u2192 readLocalAgent crash`, false, (e as Error).message)\n"
  + "      }\n"
  + "      if (listOk && readOk) {\n"
  + "        assert(`${label} \\u2192 ok`, true)\n"
  + "      }\n"
  + "    } finally {\n"
  + "      try { fs.unlinkSync(filePath) } catch {}\n"
  + "    }\n"
  + "  }\n"
  + '\n'
  + '  // 1. Fichiers vides (10 \\u00d7)\n'
  + "  for (let i = 0; i < 10; i++) {\n"
  + "    await testAgentFile(`fichier vide (${i + 1}/10)`, '')\n"
  + "  }\n"
  + '\n'
  + '  // 2. Binaires non-UTF8 (10 \\u00d7)\n'
  + "  for (let i = 0; i < 10; i++) {\n"
  + "    const buf = Buffer.alloc(128 + i * 64)\n"
  + "    for (let j = 0; j < buf.length; j++) {\n"
  + "      buf[j] = (j * 37 + i * 13) % 256\n"
  + "    }\n"
  + "    await testAgentFile(`binaire non-UTF8 (${i + 1}/10)`, buf)\n"
  + "  }\n"
  + '\n'
  + '  // 3. Syntaxe TS invalide (10 \\u00d7)\n'
  + "  const gibberish = [\n"
  + "    'improt { something } from nowhere',\n"
  + "    'const x: string = 42; const y = x + \"hello\"',\n"
  + "    'function ( { return } )',\n"
  + "    'class { extends {} }',\n"
  + "    'type X = { a: string; b: number; } & Y & Z',\n"
  + "    'export default 42 as string;',\n"
  + "    'const x: Array<Array<Array<string>>>>>>>>',\n"
  + "    'const obj = { ...null, ...undefined, ...42 }',\n"
  + "    'async function*() { yield await Promise.resolve(1) }',\n"
  + "    'const x = (a, b, c, d, e, f, g, h, ...rest) => { return }',\n"
  + "  ]\n"
  + "  for (let i = 0; i < 10; i++) {\n"
  + "    await testAgentFile(`syntaxe invalide (${i + 1}/10)`, gibberish[i])\n"
  + "  }\n"
  + '\n'
  + '  // 4. Objet TS tronqu\\u00e9 (10 \\u00d7)\n'
  + "  for (let i = 0; i < 10; i++) {\n"
  + "    const partial = [\n"
  + "      'import type { AgentDefinition }',\n"
  + "      'const definition: AgentDefinition = {',\n"
  + "      '  id: \"test-',\n"
  + "      '  displayName: \"Test',\n"
  + "      '  model: \"model' + i + '\",',\n"
  + "      '  instructionsPrompt: `Hello `,',\n"
  + "      '  toolNames: [',\n"
  + "    ].join('\\n')\n"
  + "    await testAgentFile(`objet tronqu\\u00e9 (${i + 1}/10)`, partial)\n"
  + "  }\n"
  + '\n'
  + '  // 5. Imbrication TS profonde (10 \\u00d7)\n'
  + "  for (let level = 1; level <= 10; level++) {\n"
  + "    let nested = '{}'\n"
  + "    for (let j = 0; j < level * 100; j++) {\n"
  + "      nested = '{ a: ' + nested + ', b: ' + j + ' }'\n"
  + "    }\n"
  + "    await testAgentFile(`imbrication ${level * 100} niveaux`, 'const x = ' + nested)\n"
  + "  }\n"
  + '\n'
  + '  // 6. Commentaires seuls (10 \\u00d7)\n'
  + "  const comments = [\n"
  + "    '// single line',\n"
  + "    '/* block comment */',\n"
  + "    '// ' + 'very long comment '.repeat(100),\n"
  + "    '/**\\n * JSDoc\\n * @param x - description\\n */',\n"
  + "    '// ' + 'x '.repeat(5000),\n"
  + "    '/*\\n' + '   line '.repeat(1000) + '\\n*/',\n"
  + "    '// #region collapsed',\n"
  + "    '// @ts-nocheck\\n// @ts-ignore',\n"
  + "    '/// <reference path=\"foo.d.ts\" />',\n"
  + "    '#! /usr/bin/env node\\n// shebang',\n"
  + "  ]\n"
  + "  for (let i = 0; i < 10; i++) {\n"
  + "    await testAgentFile(`commentaires seuls (${i + 1}/10)`, comments[i])\n"
  + "  }\n"
  + '\n'
  + '  // 7. Lignes extr\\u00eamement longues (10 \\u00d7)\n'
  + "  for (let i = 0; i < 10; i++) {\n"
  + "    await testAgentFile(`ligne tr\\u00e8s longue (${i + 1}/10)`, '// ' + 'verylongword'.repeat(5000 * (i + 1)) + '\\n')\n"
  + "  }\n"
  + '\n'
  + '  // 8. Caract\\u00e8res cassant les regex (10 \\u00d7)\n'
  + "  const regexBombs = [\n"
  + "    'const id = \"' + '(?:'.repeat(50) + 'hello' + ')?'.repeat(50) + '\"',\n"
  + "    'const name = \"test.\\\\\\\\w+\"',\n"
  + "    'const pattern = /(a|b|c|d|e|f|g)+/',\n"
  + "    'const x = \"' + '\\\\\\\\'.repeat(100) + '\"',\n"
  + "    'const x = \"' + '*+?{}[]()|^$'.repeat(20) + '\"',\n"
  + "    'const x = /' + '\\\\\\\\d+'.repeat(100) + '/',\n"
  + "    'const x = \"' + '\\n'.repeat(100) + '\"',\n"
  + "    'const x = `' + '\\${'.repeat(50) + '}'.repeat(50) + '`',\n"
  + "    'const x = \"' + '\\\\\\\\\\\\\\\\'.repeat(200) + '\"',\n"
  + "    'const regex = /' + '(?=)(?<=)(?<!)(?!'.repeat(20) + '/',\n"
  + "  ]\n"
  + "  for (let i = 0; i < 10; i++) {\n"
  + "    await testAgentFile(`regex breakers (${i + 1}/10)`, regexBombs[i])\n"
  + "  }\n"
  + '\n'
  + '  // 9. Caract\\u00e8res de contr\\u00f4le (10 \\u00d7)\n'
  + "  const controlChars = [\n"
  + "    '\\\\x00\\\\x00\\\\x00const id = \"test\"',\n"
  + "    '\\\\x01\\\\x02\\\\x03\\\\x04\\\\x05\\\\x06\\\\x07',\n"
  + "    '\\\\x08\\\\x09\\\\n\\\\x0B\\\\x0C\\\\r\\\\x0E\\\\x0F',\n"
  + "    '\\\\x10const x = 1\\\\x11',\n"
  + "    'const id = ' + '\\\\x00'.repeat(100) + '\"test\"',\n"
  + "    '\\\\x1B[31mRED\\\\x1B[0m const id = \"escape\"',\n"
  + "    '\\\\x7F\\\\x7F\\\\x7Fconst id = \"del\"',\n"
  + "    '\\\\x80\\\\x81\\\\x82const id = \"invalid-utf\"',\n"
  + "    '\\\\xFF\\\\xFE\\\\xFD\\\\xFC const id = \"bom-like\"',\n"
  + "    '\\\\x1B\\\\x5B\\\\x32\\\\x30\\\\x30\\\\x30\\\\x68 const id = \"ansi\"',\n"
  + "  ]\n"
  + "  for (let i = 0; i < 10; i++) {\n"
  + "    await testAgentFile(`caract\\u00e8res contr\\u00f4le (${i + 1}/10)`, controlChars[i])\n"
  + "  }\n"
  + '\n'
  + '  // 10. Types TS invalides (10 \\u00d7)\n'
  + "  const invalidTypes = [\n"
  + "    'type X = { [key: string]: number } & string extends number ? true : false',\n"
  + "    'const x: keyof typeof import(\"nonexistent\") = null',\n"
  + "    'type X<T> = T extends any ? (x: T) => void : never',\n"
  + "    'type X = { [P in keyof T]: T[P] }[keyof T]',\n"
  + "    'type X = T extends infer U ? U extends string ? U : never : never',\n"
  + "    'type X = string | number | boolean | null | undefined | void | never | any | unknown',\n"
  + "    'type X = { a: 1 } & { b: 2 } & { c: 3 } & { d: 4 }',\n"
  + "    'type X<T extends (...args: any[]) => any> = Parameters<T>',\n"
  + "    'const x: { [key: string]: { [key: string]: { [key: string]: number } } } = {}',\n"
  + "    'type X = Extract<keyof { a: string; b: number; c: boolean }, string>',\n"
  + "  ]\n"
  + "  for (let i = 0; i < 10; i++) {\n"
  + "    await testAgentFile(`types TS invalides (${i + 1}/10)`, invalidTypes[i])\n"
  + "  }\n"
  + '\n'
  + '  // Restauration de l\'\\u00e9tat initial\n'
  + "  {\n"
  + "    for (const f of fs.readdirSync(agentsDir)) {\n"
  + "      if (f.startsWith('fuzz-ts-')) {\n"
  + "        try { fs.unlinkSync(path.join(agentsDir, f)) } catch {}\n"
  + "      }\n"
  + "    }\n"
  + "    for (const [f, content] of backup) {\n"
  + "      if (content !== null) {\n"
  + "        try { fs.writeFileSync(path.join(agentsDir, f), content, 'utf-8') } catch {}\n"
  + "      }\n"
  + "    }\n"
  + "  }\n"
  + "}\n\n";

var newContent = c.slice(0, idx) + header + fuzzFunc + c.slice(idx);

// Add the call in main()
var callMarker = '  await loadTestFuzzingBenchmarks()';
var callIdx = newContent.indexOf(callMarker);
if (callIdx === -1) throw new Error('Call marker not found');
newContent = newContent.slice(0, callIdx) + '  await loadTestFuzzingAgents()\n' + newContent.slice(callIdx);

fs.writeFileSync(p, newContent, 'utf8');
console.log('OK: fuzzing agents inserted');
