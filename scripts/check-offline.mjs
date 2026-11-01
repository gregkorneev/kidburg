import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RUNTIME_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css']);
const URL_PATTERN = /\b(?:https?|wss?|file):\/\/[^\s"'`<>)]*|(?<!:)\/\/[a-z\d.-]+(?::\d+)?(?:\/[^\s"'`<>)]*)?/gi;
const SVG_NAMESPACE_URI = 'http://www.w3.org/2000/svg';

function preserveLinesAsSpaces(value) {
  return value.replace(/[^\n]/g, ' ');
}

function stripComments(source, extension) {
  if (extension === '.html') return source.replace(/<!--[\s\S]*?-->/g, preserveLinesAsSpaces);
  if (extension === '.css') return source.replace(/\/\*[\s\S]*?\*\//g, preserveLinesAsSpaces);

  let result = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; result += '\n'; } else result += ' ';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { result += '  '; i++; state = 'code'; }
      else result += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'string') {
      result += ch;
      if (ch === '\\' && next !== undefined) { result += next; i++; }
      else if (ch === quote) state = 'code';
      continue;
    }
    if (state === 'template') {
      result += ch;
      if (ch === '\\' && next !== undefined) { result += next; i++; }
      else if (ch === '`') state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') { result += '  '; i++; state = 'line'; continue; }
    if (ch === '/' && next === '*') { result += '  '; i++; state = 'block'; continue; }
    if (ch === '`') { result += ch; state = 'template'; continue; }
    if (ch === '"' || ch === "'") { result += ch; quote = ch; state = 'string'; continue; }
    result += ch;
  }
  return result;
}

async function listRuntimeFiles(root, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listRuntimeFiles(root, child));
    else if (entry.isFile() && RUNTIME_EXTENSIONS.has(path.extname(entry.name))
      && !/\.test(?: \d+)?\.(?:m?js)$/.test(entry.name)) files.push(child);
  }
  return files;
}

function isLocalUrl(value) {
  try {
    const url = new URL(value.startsWith('//') ? `http:${value}` : value);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isSvgNamespaceReference(source, index, value) {
  if (value !== SVG_NAMESPACE_URI) return false;
  const before = source.slice(0, index);
  if (/\bxmlns(?::[\w.-]+)?\s*=\s*['"`]$/.test(before)) return true;
  if (/\b(?:createElementNS|setAttributeNS)\s*\(\s*['"`]$/.test(before)) return true;
  if (/\bsetAttribute\s*\(\s*['"`]xmlns(?::[\w.-]+)?['"`]\s*,\s*['"`]$/.test(before)) return true;

  const declarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])(https?:\/\/[^'"`]+)\2/g;
  for (const declaration of source.matchAll(declarationPattern)) {
    const valueIndex = declaration.index + declaration[0].indexOf(declaration[3]);
    if (valueIndex !== index || declaration[3] !== SVG_NAMESPACE_URI) continue;
    const name = declaration[1];
    const declarationEnd = declaration.index + declaration[0].length;
    const references = [...source.slice(declarationEnd).matchAll(new RegExp(`\\b${name}\\b`, 'g'))];
    return references.length > 0 && references.every((reference) => {
      const referenceIndex = declarationEnd + reference.index;
      const prefix = source.slice(0, referenceIndex);
      return /(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?\b(?:createElementNS|setAttributeNS)\s*\(\s*$/.test(prefix)
        || /\b[A-Za-z_$][\w$]*\s*\.\s*setAttribute\s*\(\s*['"`]xmlns(?::[\w.-]+)?['"`]\s*,\s*$/.test(prefix);
    });
  }
  return false;
}

/** Find hardcoded non-loopback URL references in shipped client source files. */
export async function checkOffline(clientRoot) {
  const root = path.resolve(clientRoot);
  const violations = [];
  for (const relative of await listRuntimeFiles(root)) {
    const source = await readFile(path.join(root, relative), 'utf8');
    const active = stripComments(source, path.extname(relative));
    for (const match of active.matchAll(URL_PATTERN)) {
      const url = match[0].replace(/[.,;:!?]+$/, '');
      if (isSvgNamespaceReference(active, match.index, url)) continue;
      if (isLocalUrl(url)) continue;
      const line = active.slice(0, match.index).split('\n').length;
      violations.push({ file: relative.split(path.sep).join('/'), line, url });
    }
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.argv[2] ?? 'client');
  const violations = await checkOffline(root);
  if (violations.length) {
    for (const item of violations) console.error(`${item.file}:${item.line}: external URL ${item.url}`);
    console.error(`check:offline: ${violations.length} external URL reference(s) found`);
    process.exitCode = 1;
  } else {
    console.log(`check:offline: ${root} has no external URL references`);
  }
}
