// 解析群里 @机器人 的文本指令，规则与 course_student_app 的 Jenkinsfile 校验保持一致。

export const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/;
export const CHANNEL_PATTERN = /^[A-Za-z0-9_]{1,32}$/;
export const MAX_DESC_LENGTH = 200;

export const HELP_TEXT = [
  '用法：@机器人 打包 [qa|pro] [分支] [渠道=xxx] [检查] [说明=更新说明]',
  '例：打包',
  '例：打包 qa feature/login 说明=修复登录',
  '例：打包 pro release/1.2.0 渠道=huawei 检查',
  '默认 qa、默认分支、渠道 official；「检查」表示构建前执行 check.py full。',
].join('\n');

const BUILD_WORDS = new Set(['打包', 'build']);
const HELP_WORDS = new Set(['帮助', 'help', '?', '？']);
const CHECK_WORDS = new Set(['检查', 'check']);

/**
 * @returns {{type:'help'} | {type:'error', message:string} |
 *   {type:'build', httpEnv:string, branch:string, channel:string, runChecks:boolean, updateDesc:string}}
 */
export function parseCommand(text, { defaultBranch = 'main' } = {}) {
  const content = (text ?? '').trim();
  if (!content) return { type: 'help' };

  // 「说明=」之后整段原样作为更新说明，允许包含空格。
  let head = content;
  let updateDesc = '';
  const descMatch = content.match(/(?:^|\s)(?:说明|desc)[=＝:：]/);
  if (descMatch) {
    head = content.slice(0, descMatch.index);
    updateDesc = content.slice(descMatch.index + descMatch[0].length).trim();
  }

  const [verb, ...tokens] = head.split(/\s+/).filter(Boolean);
  if (!verb || HELP_WORDS.has(verb.toLowerCase())) return { type: 'help' };
  if (!BUILD_WORDS.has(verb.toLowerCase())) {
    return { type: 'error', message: `不认识的指令「${verb}」\n${HELP_TEXT}` };
  }

  const result = {
    type: 'build',
    httpEnv: 'qa',
    branch: defaultBranch,
    channel: 'official',
    runChecks: false,
    updateDesc,
  };
  let branchSet = false;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const channelMatch = token.match(/^(?:渠道|channel)[=＝:：](.*)$/);
    if (lower === 'qa' || lower === 'pro') {
      result.httpEnv = lower;
    } else if (CHECK_WORDS.has(lower)) {
      result.runChecks = true;
    } else if (channelMatch) {
      result.channel = channelMatch[1];
    } else if (!branchSet) {
      result.branch = token;
      branchSet = true;
    } else {
      return { type: 'error', message: `多余的参数「${token}」\n${HELP_TEXT}` };
    }
  }

  if (!BRANCH_PATTERN.test(result.branch)) {
    return { type: 'error', message: '分支名只允许 A-Z a-z 0-9 . _ / -，最长 100 字符' };
  }
  if (!CHANNEL_PATTERN.test(result.channel)) {
    return { type: 'error', message: '渠道只允许 A-Z a-z 0-9 _，最长 32 字符' };
  }
  if (result.updateDesc.length > MAX_DESC_LENGTH) {
    return { type: 'error', message: `更新说明最多 ${MAX_DESC_LENGTH} 字` };
  }
  return result;
}
