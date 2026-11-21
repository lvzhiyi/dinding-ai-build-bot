import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createJenkinsClient } from '../src/jenkins.js';

// 本地 mock Jenkins，部署在 /jenkins 子路径，校验认证头与表单参数。
let server;
let baseUrl;
const requests = [];

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      if (req.headers.authorization !== `Basic ${Buffer.from('bridge:tkn').toString('base64')}`) {
        res.writeHead(401).end();
      } else if (req.url === '/jenkins/job/course_student_app/buildWithParameters') {
        res.writeHead(201, { Location: 'http://other-host:8080/jenkins/queue/item/42/' }).end();
      } else if (req.url === '/jenkins/queue/item/42/api/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ executable: { number: 9, url: 'http://j/job/course_student_app/9/' } }));
      } else if (req.url.startsWith('/jenkins/queue/api/json')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: [{ task: { name: 'course_student_app' } }, { task: { name: 'other' } }] }));
      } else if (req.url.startsWith('/jenkins/job/course_student_app/lastBuild/api/json')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ number: 8, building: true }));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/jenkins`;
});

after(() => server.close());

const client = () => createJenkinsClient({ url: baseUrl, job: 'course_student_app', user: 'bridge', apiToken: 'tkn' });

test('触发构建并把 Location 改回配置的主机', async () => {
  const location = await client().trigger({ BRANCH: 'main', UPDATE_DESC: '修复 a&b' });
  assert.equal(location, '/queue/item/42');
  const sent = requests.find((r) => r.url.endsWith('buildWithParameters'));
  assert.equal(new URLSearchParams(sent.body).get('UPDATE_DESC'), '修复 a&b');
  const item = await client().queueItem(location);
  assert.equal(item.buildNumber, 9);
});

test('统计本 Job 的运行与排队数', async () => {
  assert.deepEqual(await client().backlog(), { running: true, queued: 1 });
});

test('认证失败抛出带状态码的错误', async () => {
  const bad = createJenkinsClient({ url: baseUrl, job: 'course_student_app', user: 'bridge', apiToken: 'wrong' });
  await assert.rejects(bad.trigger({}), { status: 401 });
});
