// Jenkins REST 调用：用 API Token 走 Basic 认证，此方式不需要 crumb。

export class JenkinsError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createJenkinsClient({ url, job, user, apiToken }, { fetchImpl = fetch } = {}) {
  const jobPath = job
    .split('/')
    .map((part) => `job/${encodeURIComponent(part)}`)
    .join('/');
  const auth = `Basic ${Buffer.from(`${user}:${apiToken}`).toString('base64')}`;

  async function request(path, init = {}) {
    const target = `${url}/${path.replace(/^\/+/, '')}`;
    const response = await fetchImpl(target, {
      ...init,
      headers: { Authorization: auth, ...init.headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 400) {
      throw new JenkinsError(`Jenkins 返回 HTTP ${response.status}`, response.status);
    }
    return response;
  }

  async function json(path) {
    const response = await request(path);
    return response.json();
  }

  return {
    /** 触发参数化构建，返回队列项地址。 */
    async trigger(parameters) {
      const body = new URLSearchParams(parameters);
      const response = await request(`${jobPath}/buildWithParameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const location = response.headers.get('location');
      if (response.status !== 201 || !location) {
        throw new JenkinsError(`Jenkins 未返回队列地址（HTTP ${response.status}）`, response.status);
      }
      // 只取路径，拼回配置的 Jenkins 地址，避免把认证头发往 Location 指向的其他主机。
      // Jenkins 部署在子路径（如 /jenkins）时去掉前缀，再由 request 拼回。
      const basePath = new URL(url).pathname.replace(/\/+$/, '');
      const path = new URL(location, url).pathname.replace(/\/+$/, '');
      return basePath && path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
    },

    /** 队列项状态：已开始时带 buildNumber/buildUrl。 */
    async queueItem(location) {
      const item = await json(`${location}/api/json`);
      return {
        cancelled: Boolean(item.cancelled),
        why: item.why ?? '',
        buildNumber: item.executable?.number ?? null,
        buildUrl: item.executable?.url ?? '',
      };
    },

    /** 本 Job 正在运行的构建与排队中的数量，用于告诉发起人前面还有几个。 */
    async backlog() {
      const [lastBuild, queue] = await Promise.all([
        json(`${jobPath}/lastBuild/api/json?tree=number,building`).catch(() => null),
        json('queue/api/json?tree=items[task[name]]'),
      ]);
      const jobName = job.split('/').at(-1);
      const queued = (queue.items ?? []).filter((item) => item.task?.name === jobName).length;
      return { running: Boolean(lastBuild?.building), queued };
    },
  };
}
