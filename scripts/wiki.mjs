// Общий для Codex и Claude Code доступ к GitHub Wiki.
//   npm run wiki:status   состояние локального клона и удалённой Wiki
//   npm run wiki:pull     получить актуальные страницы (клонирует при первом запуске)
//   npm run wiki:push     закоммитить локальные правки (-m "..."), подтянуть удалённые, отправить
// Клон лежит вне репозитория: ../<имя репозитория>.wiki (или WIKI_DIR). Без --force.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const tryGit = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

export function wikiRemote(origin) {
  return origin.replace(/\.git$/, '').replace(/\/$/, '') + '.wiki.git';
}

export function wikiDir(origin) {
  if (process.env.WIKI_DIR) return path.resolve(process.env.WIKI_DIR);
  const name = origin.replace(/\.git$/, '').split(/[/:]/).pop();
  return path.resolve(ROOT, '..', `${name}.wiki`);
}

function context() {
  const origin = git(ROOT, 'remote', 'get-url', 'origin');
  return { remote: wikiRemote(origin), dir: wikiDir(origin) };
}

function remoteReachable(remote) {
  const r = tryGit(ROOT, 'ls-remote', remote);
  return { ok: r.status === 0, empty: r.status === 0 && !r.stdout.trim(), err: r.stderr.trim() };
}

function ensureLocal({ remote, dir }) {
  if (existsSync(path.join(dir, '.git'))) return true;
  const probe = remoteReachable(remote);
  if (probe.ok && !probe.empty) {
    const r = tryGit(ROOT, 'clone', remote, dir);
    if (r.status !== 0) throw new Error(r.stderr);
    return true;
  }
  // Удалённая Wiki ещё не создана: заводим локальный клон, привязанный к адресу Wiki.
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'master');
  git(dir, 'remote', 'add', 'origin', remote);
  console.log(`wiki: удалённая Wiki пока недоступна (${probe.err.split('\n')[0] || 'пусто'}); создан локальный клон ${dir}`);
  return false;
}

const commands = {
  status() {
    const c = context();
    console.log(`wiki: адрес ${c.remote}\nwiki: клон  ${c.dir}`);
    const probe = remoteReachable(c.remote);
    console.log(`wiki: удалённая Wiki ${probe.ok ? (probe.empty ? 'пуста' : 'доступна') : 'недоступна (первую страницу должен создать владелец на github.com)'}`);
    if (!existsSync(path.join(c.dir, '.git'))) return console.log('wiki: локального клона нет, выполните npm run wiki:pull');
    const st = git(c.dir, 'status', '--short', '--branch');
    console.log(st);
    const unpushed = tryGit(c.dir, 'rev-list', '--count', '@{u}..HEAD');
    if (unpushed.status === 0) console.log(`wiki: неотправленных коммитов: ${unpushed.stdout.trim()}`);
  },
  pull() {
    const c = context();
    if (!ensureLocal(c)) return;
    if (git(c.dir, 'status', '--porcelain')) return console.log('wiki: есть незакоммиченные правки, pull пропущен (сначала wiki:push)');
    const r = tryGit(c.dir, 'pull', '--rebase', 'origin', git(c.dir, 'rev-parse', '--abbrev-ref', 'HEAD'));
    console.log(r.status === 0 ? 'wiki: актуально' : `wiki: pull не выполнен: ${r.stderr.trim()}`);
    process.exitCode = r.status;
  },
  push(message) {
    const c = context();
    if (!ensureLocal(c)) { /* локальный клон создан, продолжаем коммитить */ }
    if (git(c.dir, 'status', '--porcelain')) {
      if (!message) throw new Error('укажите сообщение: npm run wiki:push -- "область: что сделано"');
      git(c.dir, 'add', '-A');
      git(c.dir, 'commit', '-m', message);
    }
    const branch = git(c.dir, 'rev-parse', '--abbrev-ref', 'HEAD');
    const probe = remoteReachable(c.remote);
    if (probe.ok && !probe.empty) {
      const r = tryGit(c.dir, 'pull', '--rebase', 'origin', branch);
      if (r.status !== 0) throw new Error(`конфликт при синхронизации, разрешите вручную (git -C ${c.dir} status):\n${r.stderr}`);
    }
    const r = tryGit(c.dir, 'push', 'origin', `HEAD:${branch}`);
    if (r.status !== 0) {
      console.error(`wiki: ОТПРАВКА НЕ ВЫПОЛНЕНА, коммиты лежат только локально:\n${r.stderr.trim()}`);
      process.exitCode = 1;
      return;
    }
    console.log('wiki: опубликовано');
  },
};

const [cmd, ...rest] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!commands[cmd]) {
    console.error('использование: node scripts/wiki.mjs status|pull|push ["сообщение коммита"]');
    process.exit(2);
  }
  try {
    commands[cmd](rest.join(' ') || undefined);
  } catch (e) {
    console.error(`wiki: ${e.message}`);
    process.exit(1);
  }
}
