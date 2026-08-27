# Cross-border E-commerce Daily Report Skill

为跨境电商卖家准备的每日行业资讯参考工具。它从公开 RSS/Atom 来源汇集平台政策、跨境物流、海外仓、关务与关税、市场趋势等信息，按关键词筛选、排序和去重，生成便于每天快速浏览的 HTML/JSON 日报；确认内容后，也可以选择推送到指定 webhook。

## 卖家每天可以关注什么

- **平台规则与费用**：Amazon、eBay、TikTok Shop 等平台的政策、费用和履约变化。
- **物流与履约**：海运、空运、尾程配送、海外仓、供应链及旺季异常。
- **关务与合规**：关税、清关、贸易政策和跨境监管动态。
- **市场与选品信号**：重点市场、消费趋势、渠道变化及潜在经营机会。

日报适合作为每天快速发现行业信号的资讯入口，不替代平台公告、法规原文或专业意见。涉及经营、合规和资金决策时，请打开报告中的原始链接进一步核实。

## 安全设计

- 仓库不包含 API Key、Webhook URL、账号、群聊 ID、内部路径、数据库或历史业务数据。
- 默认只生成本地文件，不会自动推送。
- 必须同时提供运行时环境变量和 `--push` 才会发送外部请求。
- API Key 和 Webhook 只从进程环境读取，脚本不会打印或写入报告。
- 配置拒绝 localhost、`.local`、私网 IP、解析到私网的域名、危险重定向、非 HTTP(S) 协议和 URL 内嵌凭据。
- 发布历史只保存日期和 SHA-256 哈希，不保存标题、链接或正文。
- HTML 对来自 feed 的文本进行转义；网络请求具有超时和响应体积限制。

## 仓库结构

```text
Cross-border-E-commerce-Daily-Report-skill/
├── README.md
├── package.json
├── cross-border-e-commerce-daily-report/
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   ├── references/
│   │   ├── configuration.md
│   │   └── sources.example.json
│   └── scripts/push_daily_report.mjs
└── tests/
```

## 环境要求

- Node.js 20 或更高版本。
- 本地生成不需要第三方 npm 依赖。
- AI 摘要和 webhook 推送都是可选功能。

## 安装为 Codex Skill

将仓库中的 `cross-border-e-commerce-daily-report/` 复制到 Codex Skills 目录：

```bash
cp -R cross-border-e-commerce-daily-report "${CODEX_HOME:-$HOME/.codex}/skills/cross-border-e-commerce-daily-report"
```

重新启动 Codex 后，可通过 `$cross-border-e-commerce-daily-report` 使用。

## 快速开始

公开示例配置默认关注跨境电商、平台、物流、海外仓、关务和供应链等主题。从仓库根目录执行：

```bash
node cross-border-e-commerce-daily-report/scripts/push_daily_report.mjs \
  --config cross-border-e-commerce-daily-report/references/sources.example.json \
  --output-dir ./daily-report-output \
  --no-ai
```

输出：

- `daily-report-output/daily-report_YYYY-MM-DD.html`
- `daily-report-output/daily-report_YYYY-MM-DD.json`

示例配置只包含公开 feed 地址和通用跨境电商关键词。建议复制后再修改：

```bash
cp cross-border-e-commerce-daily-report/references/sources.example.json ./sources.local.json
```

`sources.local.json` 如包含内部来源，应加入本机忽略规则，不要提交。

## 可选 AI 摘要

在配置中将 `ai.enabled` 设为 `true`，并通过安全运行环境提供以下变量：

```text
DAILY_REPORT_AI_BASE_URL
DAILY_REPORT_AI_API_KEY
DAILY_REPORT_AI_MODEL
```

缺少任意变量时，脚本会保留 feed 自带摘要，不会要求在聊天或配置文件中粘贴 Key。

## 可选推送

先生成并人工检查 HTML/JSON。确认目标与内容后，再通过运行时环境提供 `DAILY_REPORT_WEBHOOK_URL` 并显式添加 `--push`：

```bash
DAILY_REPORT_WEBHOOK_URL="<runtime-secret>" \
node cross-border-e-commerce-daily-report/scripts/push_daily_report.mjs \
  --config ./sources.local.json \
  --output-dir ./daily-report-output \
  --push
```

支持的 `webhookType`：

- `feishu`：发送飞书自定义机器人纯文本消息。
- `generic-json`：发送标准 JSON 摘要。

不要把真实 URL 写入命令历史、Issue、日志、截图或仓库文件；生产环境应使用 CI/CD Secrets 或其他密钥管理工具注入。

## 命令参数

```bash
node cross-border-e-commerce-daily-report/scripts/push_daily_report.mjs --help
```

详细字段和安全边界见 [configuration.md](cross-border-e-commerce-daily-report/references/configuration.md)。

## 测试

```bash
npm test
npm run check
```

测试使用本地虚构 RSS，不访问真实 feed、不调用 AI、不推送 webhook。
