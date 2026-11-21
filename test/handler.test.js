import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createHandler } from '../src/handler.js';

const silent = { info() {}, warn() {}, error() {} };

function setup({ queueItems = [{ buildNumber: 12 }], backlog = { running: false, queued: 0 }, env = {} } = {}) {
  const config = loadConfig({
    DINGTALK_CLIENT_ID: 'id',
    DINGTALK_CLIENT_SECRET: 'secret',
    JENKINS_URL: 'http://jenkins.local',
    JENKINS_USER: 'bridge',
    JENKINS_API_TOKEN: 'token',
    ALLOWED_STAFF_IDS: 'u1, u2',
    PRO_ALLOWED_STAFF_IDS: 'u1',
    ...env,
  });
  const triggered = [];
  const replies = [];
  const jenkins = {
    async backlog() {
      return backlog;
    },
    async trigger(parameters) {
      triggered.push(parameters);
      return '/queue/item/7';
    },
    async queueItem() {
      return { cancelled: false, buildNumber: null, ...(queueItems.shift() ?? {}) };
    },
  };
  const handle = createHandler({
    config,
    jenkins,
    reply: async (_message, text) => replies.push(text),
    logger: silent,
    wait: async () => {},
    queueWaitMs: 0,
  });
  return { handle, triggered, replies, jenkins };
}

let seq = 0;
function message(content, overrides = {}) {
  seq += 1;
  return {
    msgId: `m${seq}`,
    msgtype: 'text',
    text: { content },
    senderStaffId: 'u2',
    senderNick: '小明',
    conversationId: 'cidAbc+/=',
    conversationType: '2',
    ...overrides,
  };
}

test('白名单用户触发 qa 构建，参数按契约透传', async () => {
  const { handle, triggered, replies } = setup();
  await handle(message('打包 feature/x 说明=冒烟'));
  assert.deepEqual(triggered, [
    {
      PLATFORM: 'android',
      HTTP_ENV: 'qa',
      BRANCH: 'feature/x',
      CHANNEL: 'official',
      UPDATE_DESC: '冒烟',
      RUN_CHECKS: 'false',
      REQUESTER_ID: 'u2',
      REQUESTER_NAME: '小明',
      CONVERSATION_ID: 'cidAbc+/=',
    },
  ]);
  assert.match(replies[0], /已开始打包 #12/);
});

test('排队时回复前面还有几个', async () => {
  const { handle, replies } = setup({ queueItems: [], backlog: { running: true, queued: 2 } });
  await handle(message('打包'));
  assert.match(replies[0], /排队中，前面还有 3 个/);
});

test('非白名单用户被拒绝且不触发', async () => {
  const { handle, triggered, replies } = setup();
  await handle(message('打包', { senderStaffId: 'stranger' }));
  assert.equal(triggered.length, 0);
  assert.match(replies[0], /没有打包权限/);
});

test('pro 只允许 pro 白名单', async () => {
  const { handle, triggered, replies } = setup();
  await handle(message('打包 pro'));
  assert.equal(triggered.length, 0);
  assert.match(replies[0], /pro/);
  await handle(message('打包 pro', { senderStaffId: 'u1' }));
  assert.equal(triggered[0].HTTP_ENV, 'pro');
});

test('重复 msgId 只处理一次', async () => {
  const { handle, triggered } = setup();
  const msg = message('打包');
  await handle(msg);
  await handle(msg);
  assert.equal(triggered.length, 1);
});

test('未授权群的消息被忽略', async () => {
  const { handle, triggered, replies } = setup({ env: { ALLOWED_CONVERSATION_IDS: 'cidOther' } });
  await handle(message('打包'));
  assert.equal(triggered.length, 0);
  assert.equal(replies.length, 0);
});

test('非法参数直接回复错误，不触发', async () => {
  const { handle, triggered, replies } = setup();
  await handle(message('打包 a;b'));
  assert.equal(triggered.length, 0);
  assert.match(replies[0], /分支名/);
});

test('Jenkins 失败时回复且不泄露凭据', async () => {
  const { handle, replies, jenkins } = setup();
  jenkins.trigger = async () => {
    throw new Error('Jenkins 返回 HTTP 401');
  };
  await handle(message('打包'));
  assert.match(replies[0], /触发 Jenkins 失败.*401/);
  assert.doesNotMatch(replies[0], /token|secret/);
});

test('缺必填配置时启动失败', () => {
  assert.throws(() => loadConfig({}), /DINGTALK_CLIENT_ID/);
});
