// 入口：连上钉钉 Stream，把机器人消息交给 handler。Stream 由本服务主动连出，无需公网入口。

import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import { loadConfig } from './config.js';
import { createHandler } from './handler.js';
import { createJenkinsClient } from './jenkins.js';
import { createReplier } from './reply.js';

const config = loadConfig();
const client = new DWClient({
  clientId: config.dingtalk.clientId,
  clientSecret: config.dingtalk.clientSecret,
  // 开启 ping/pong 心跳，连接半断时主动重连。
  keepAlive: true,
});

const handle = createHandler({
  config,
  jenkins: createJenkinsClient(config.jenkins),
  reply: createReplier(),
});

client.registerCallbackListener(TOPIC_ROBOT, (downstream) => {
  // 先 ack，避免处理期间钉钉在 60 秒内重推；重复投递再由 msgId 去重兜底。
  client.socketCallBackResponse(downstream.headers.messageId, { status: 'SUCCESS' });
  let message;
  try {
    message = JSON.parse(downstream.data);
  } catch {
    console.error('无法解析机器人消息');
    return;
  }
  handle(message).catch((error) => console.error(`处理消息失败：${error.message}`));
});

// SDK 的 connect() 会吞掉错误并每秒静默重试，先自行校验一次凭据与网络，失败直接退出交给 pm2 重启。
try {
  await client.getEndpoint();
} catch (error) {
  console.error(`无法获取钉钉 Stream 接入点，检查 ClientId/Secret 与出网：${error.message}`);
  process.exit(1);
}
await client.connect();
console.info(`钉钉 Stream 连接已发起，Jenkins Job：${config.jenkins.job}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    client.disconnect();
    process.exit(0);
  });
}
