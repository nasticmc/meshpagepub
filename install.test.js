import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const helper = path.join(root, 'systemd-unit.sh');

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function bash(expression) {
  return spawnSync('bash', ['-c', `source ${shellQuote(helper)}; ${expression}`], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('systemd installer uses a system service for root installs', () => {
  const result = bash('meshpagepub_systemd_scope 0');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'system');
});

test('systemd installer retains user-service scope for non-root installs', () => {
  const result = bash('meshpagepub_systemd_scope 1000');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'user');
});

test('system unit is boot-scoped and targets the application paths', () => {
  const result = bash(`render_meshpagepub_unit system '/usr/bin/node' '/srv/mesh app' '0.0.0.0' '8123'`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /User=root/);
  assert.match(result.stdout, /WorkingDirectory=\/srv\/mesh\\x20app/);
  assert.match(result.stdout, /ExecStart="\/usr\/bin\/node" "\/srv\/mesh app\/server\.js" --host "0\.0\.0\.0" --port "8123"/);
  assert.match(result.stdout, /WantedBy=multi-user\.target/);
});

test('user unit remains login-scoped and preserves systemd path escaping', () => {
  const result = bash(`render_meshpagepub_unit user '/usr/bin/node' '/home/user/mesh app' '127.0.0.1' '9000'`);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /User=root/);
  assert.match(result.stdout, /WorkingDirectory=\/home\/user\/mesh\\x20app/);
  assert.match(result.stdout, /WantedBy=default\.target/);
});

test('installer routes root scope to a systemd service', () => {
  const installer = readFileSync(path.join(root, 'install.sh'), 'utf8');
  assert.match(installer, /source "\$ROOT\/systemd-unit\.sh"/);
  assert.match(installer, /meshpagepub_systemd_scope "\$EUID"/);
  assert.match(installer, /unit_dir=\/etc\/systemd\/system/);
  assert.match(installer, /systemctl enable --now meshpagepub\.service/);
});
