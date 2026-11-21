# dingtalk-build-bridge

钉钉群 @打包机器人 → 本服务（Stream 长连接，主动连出，无需公网入口）→ 触发内网 Jenkins `course_student_app` Job。

- 本服务只负责：解析指令、白名单鉴权、msgId 去重、调用 Jenkins `buildWithParameters`、回复「已开始 / 排队中 / 拒绝」。
- 最终结果（下载页、二维码、@发起人）由 Jenkins 的 `scripts/ci_notify.sh` 直接发群自定义机器人 Webhook，本服务不参与；`/notify` 回调未实现，Jenkins 的 `NOTIFY_URL` 保持不配置。
- 参数契约见 course_student_app 仓库 `openspec/changes/add-dingtalk-jenkins-release/design.md`。

## 指令

```
@打包机器人 打包 [qa|pro] [分支] [渠道=xxx] [检查] [说明=更新说明]
@打包机器人 帮助
```

| 示例 | 含义 |
| --- | --- |
| `打包` | qa、默认分支（`DEFAULT_BRANCH`）、渠道 official |
| `打包 qa feature/login 说明=修复登录` | 指定分支和蒲公英更新说明（说明可含空格，须放最后） |
| `打包 pro release/1.2.0 渠道=huawei 检查` | pro 包，构建前跑 `check.py full`，需 pro 白名单 |

校验规则与 Jenkinsfile 一致：分支 `^[A-Za-z0-9._/-]{1,100}$`，渠道 `^[A-Za-z0-9_]{1,32}$`，说明 ≤200 字。

## 权限

- `ALLOWED_STAFF_IDS`：可打 qa 包的钉钉 staffId（员工 userId），逗号分隔，必填。
- `PRO_ALLOWED_STAFF_IDS`：可打 pro 包的 staffId；未配置时任何人都不能打 pro。
- `ALLOWED_CONVERSATION_IDS`：可选，只响应这些群；其他群的消息直接忽略、不回复。
- staffId 可在钉钉管理后台「通讯录 → 成员详情」查看；首次 @机器人 被拒时，服务日志也会打印 `拒绝未授权用户 昵称(staffId)`。

## 一次性准备

### 1. 钉钉企业内部应用机器人（需企业管理员或开发者权限）

1. 钉钉开发者后台 → 应用开发 → 企业内部应用 → 创建应用。
2. 「凭证与基础信息」记下 ClientId、ClientSecret，填入 `.env`。
3. 「添加应用能力」→ 机器人：填写名称（如「打包机器人」），**消息接收模式选 Stream 模式**。
4. 「版本管理与发布」发布应用，可见范围包含需要打包的同事。
5. 在目标群：群设置 → 机器人 → 添加机器人 → 选择该企业内部应用机器人。

### 2. Jenkins 专用用户

1. 新建用户 `dingtalk-bridge`，授权策略中只授予 `course_student_app` Job 的 **Job/Build、Job/Read**（以及 Overall/Read）。
2. 用该用户登录 → 设置 → API Token → 生成，填入 `JENKINS_API_TOKEN`。
3. API Token 认证下调用 `buildWithParameters` 不需要 CSRF crumb。

## 部署（Jenkins 同机，pm2）

要求 Node.js ≥ 20.12（支持 `--env-file-if-exists`），能出网访问 `api.dingtalk.com`，能访问内网 Jenkins。

```bash
npm ci --omit=dev
cp .env.example .env   # 填写凭据与白名单，chmod 600 .env
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup   # 开机自启，按提示执行输出的命令
pm2 logs dingtalk-build-bridge
```

启动时先向钉钉获取 Stream 接入点，凭据错误或无法出网会打印原因并退出，pm2 每 5 秒重启。修改 `.env` 后执行 `pm2 restart dingtalk-build-bridge`。

## 本地开发

```bash
npm install
npm test          # 指令解析、鉴权、去重、Jenkins mock 调用
npm start         # 读取 .env 连接真实钉钉 Stream
```
