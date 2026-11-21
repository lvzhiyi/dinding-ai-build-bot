// 处理一条机器人消息：去重 → 鉴权 → 解析 → 触发 Jenkins → 回复受理结果。
// 最终构建结果由 Jenkins 的 ci_notify.sh 直接发群机器人 Webhook，这里不负责。

import { HELP_TEXT, parseCommand } from './command.js';

const DEDUPE_TTL_MS = 10 * 60 * 1000;
const QUEUE_WAIT_MS = 10_000;
const QUEUE_POLL_MS = 2_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CONVERSATION_PATTERN = /^[A-Za-z0-9+/=_-]{1,128}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createHandler({ config, jenkins, reply, logger = console, wait = sleep, queueWaitMs = QUEUE_WAIT_MS }) {
  const seen = new Map();

  function isDuplicate(msgId) {
    const now = Date.now();
    for (const [id, at] of seen) {
      if (now - at > DEDUPE_TTL_MS) seen.delete(id);
    }
    if (seen.has(msgId)) return true;
    seen.set(msgId, now);
    return false;
  }

  async function waitForStart(location) {
    const deadline = Date.now() + queueWaitMs;
    for (;;) {
      const item = await jenkins.queueItem(location);
      if (item.cancelled || item.buildNumber || Date.now() >= deadline) return item;
      await wait(QUEUE_POLL_MS);
    }
  }

  return async function handle(message) {
    const { msgId, senderStaffId, senderNick, conversationId } = message;
    if (!msgId || isDuplicate(msgId)) return;

    const send = (text) => reply(message, text);
    const who = `${senderNick ?? ''}(${senderStaffId ?? '-'})`;

    if (config.allowedConversationIds.size && !config.allowedConversationIds.has(conversationId)) {
      logger.warn(`忽略未授权会话的消息 ${who}`);
      return;
    }
    if (message.msgtype !== 'text') {
      await send(HELP_TEXT);
      return;
    }

    const command = parseCommand(message.text?.content, { defaultBranch: config.defaultBranch });
    if (command.type === 'help') {
      await send(HELP_TEXT);
      return;
    }
    if (command.type === 'error') {
      await send(command.message);
      return;
    }
    if (!senderStaffId || !config.allowedStaffIds.has(senderStaffId)) {
      logger.warn(`拒绝未授权用户 ${who}`);
      await send('你没有打包权限，请联系管理员加入白名单。');
      return;
    }
    if (command.httpEnv === 'pro' && !config.proAllowedStaffIds.has(senderStaffId)) {
      logger.warn(`拒绝 pro 越权 ${who}`);
      await send('你没有打 pro 包的权限，可以先打 qa 包。');
      return;
    }

    const summary = `${command.httpEnv} · ${command.branch} · ${command.channel}${command.runChecks ? ' · 含检查' : ''}`;
    let location;
    try {
      const backlog = await jenkins.backlog().catch(() => null);
      location = await jenkins.trigger({
        PLATFORM: 'android',
        HTTP_ENV: command.httpEnv,
        BRANCH: command.branch,
        CHANNEL: command.channel,
        UPDATE_DESC: command.updateDesc,
        RUN_CHECKS: String(command.runChecks),
        REQUESTER_ID: ID_PATTERN.test(senderStaffId) ? senderStaffId : '',
        REQUESTER_NAME: (senderNick ?? '').slice(0, 64),
        CONVERSATION_ID: CONVERSATION_PATTERN.test(conversationId ?? '') ? conversationId : '',
      });
      logger.info(`已触发 ${summary}，发起 ${who}，队列 ${location}`);

      const item = await waitForStart(location);
      if (item.cancelled) {
        await send(`打包请求被 Jenkins 取消：${summary}`);
      } else if (item.buildNumber) {
        await send(`已开始打包 #${item.buildNumber}：${summary}\n完成后结果会发到群里。`);
      } else {
        const ahead = backlog ? backlog.queued + (backlog.running ? 1 : 0) : null;
        const position = ahead ? `，前面还有 ${ahead} 个` : '';
        await send(`已受理，排队中${position}：${summary}\n完成后结果会发到群里。`);
      }
    } catch (error) {
      logger.error(`触发失败 ${summary}，发起 ${who}：${error.message}`);
      const hint = location ? '已提交到 Jenkins，但查询排队状态失败，请稍后在群里留意结果。' : '触发 Jenkins 失败，请联系管理员。';
      await send(`${hint}（${error.message}）`);
    }
  };
}
