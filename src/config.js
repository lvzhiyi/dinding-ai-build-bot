// 从环境变量读取配置，缺必填项时启动即失败。凭据只来自环境变量或 .env，不写入仓库。

const REQUIRED = [
  'DINGTALK_CLIENT_ID',
  'DINGTALK_CLIENT_SECRET',
  'JENKINS_URL',
  'JENKINS_USER',
  'JENKINS_API_TOKEN',
  'ALLOWED_STAFF_IDS',
];

function list(value) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`缺少环境变量：${missing.join(', ')}`);
  }
  return {
    dingtalk: {
      clientId: env.DINGTALK_CLIENT_ID.trim(),
      clientSecret: env.DINGTALK_CLIENT_SECRET.trim(),
    },
    jenkins: {
      url: env.JENKINS_URL.trim().replace(/\/+$/, ''),
      job: env.JENKINS_JOB?.trim() || 'course_student_app',
      user: env.JENKINS_USER.trim(),
      apiToken: env.JENKINS_API_TOKEN.trim(),
    },
    allowedStaffIds: list(env.ALLOWED_STAFF_IDS),
    // 未配置时任何人都不能打 pro 包。
    proAllowedStaffIds: list(env.PRO_ALLOWED_STAFF_IDS),
    // 未配置时不限制群。
    allowedConversationIds: list(env.ALLOWED_CONVERSATION_IDS),
    defaultBranch: env.DEFAULT_BRANCH?.trim() || 'main',
  };
}
