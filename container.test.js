import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=name=>readFileSync(new URL(`./${name}`,import.meta.url),'utf8');

test('ships a Node 22 Compose deployment with persistent collaboration state', () => {
  const dockerfile=read('Dockerfile'),compose=read('compose.yml'),ignore=read('.dockerignore');
  assert.match(dockerfile,/FROM node:22-/);
  assert.match(dockerfile,/npm ci/);
  assert.match(dockerfile,/npm run build/);
  assert.match(dockerfile,/MESHPAGEPUB_DATA_DIR=\/var\/lib\/meshpagepub/);
  assert.match(dockerfile,/USER node/);
  assert.match(compose,/image:.*meshpagepub/);
  assert.match(compose,/8000:8000/);
  assert.match(compose,/meshpagepub-state:\/var\/lib\/meshpagepub/);
  assert.match(compose,/restart: unless-stopped/);
  assert.match(ignore,/node_modules/);
  assert.match(ignore,/\.git/);
});
