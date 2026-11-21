// 通过消息自带的 sessionWebhook 回复发起人。sessionWebhook 会过期，只用于即时的受理回复。

export function createReplier({ logger = console, fetchImpl = fetch } = {}) {
  return async function reply(message, text) {
    if (!message.sessionWebhook || Date.now() > Number(message.sessionWebhookExpiredTime ?? 0)) {
      logger.warn('sessionWebhook 缺失或已过期，跳过回复');
      return;
    }
    const isGroup = message.conversationType === '2';
    const body = {
      msgtype: 'text',
      text: { content: text },
      ...(isGroup && message.senderStaffId ? { at: { atUserIds: [message.senderStaffId] } } : {}),
    };
    try {
      const response = await fetchImpl(message.sessionWebhook, {
        method: 'POST',
        // sessionWebhook 地址自带会话凭证，不需要另取 access_token。
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || (result.errcode && result.errcode !== 0)) {
        logger.error(`回复失败：HTTP ${response.status} errcode=${result.errcode ?? '-'} ${result.errmsg ?? ''}`);
      }
    } catch (error) {
      logger.error(`回复失败：${error.message}`);
    }
  };
}
