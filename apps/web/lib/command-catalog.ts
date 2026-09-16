// 快捷指令目录：仓内静态常量（进 git 可审，审核员可直接读本文件）。
// 红线：本文件只在服务端引用；客户端通过 GET /api/chat/commands 取剥离
// promptTemplate 后的元数据，prompt 模板永不进前端、组装只在 BFF。
//
// 目标 agent 白名单（§8）：sales-cs 是对外 crew，绝不开放。
// 修订（审核 §五）：param 增 description/placeholder/defaultValue（P5）；
// 条目增 observationPage（P1 产物观测直达）；sys-diagnose 只读强化（§10.5）。

export type CommandGroup = "平台运营" | "内容生产" | "BD" | "IR" | "系统";

export type CommandParam = {
  key: string;
  label: string;
  type: "text" | "choice";
  required: boolean;
  options?: string[];
  /** help text：卡片表单里 label 下的说明行 */
  description?: string;
  placeholder?: string;
  defaultValue?: string;
};

export type CommandDef = {
  id: string;
  group: CommandGroup;
  label: string;
  description: string;
  targetAgentId: "main" | "content-producer" | "it-engineer";
  promptTemplate: string;
  params: CommandParam[];
};

// P1：发送成功回执的产物观测页（审核修订表；按 sessionKey 过滤高亮降级 backlog）
export const OBSERVATION_PAGES: Record<string, string> = {
  "wx-mp-produce": "/publish",
  "xhs-produce": "/publish",
  "douyin-produce": "/publish",
  "wx-channel-produce": "/publish",
  "twitter-produce": "/publish",
  "video-full": "/videos",
  "manim-explainer": "/videos",
  "design-visual": "/videos",
  "bd-find-customers": "/customers",
  "bd-intel-brief": "/customers",
  "ir-matter": "/bd-ir",
  "cron-create": "/cron",
  "sys-diagnose": "/config",
  relogin: "/logins",
};

// 组合指令模板要点（源自各 expert 包 SKILL.md 触发语）：说目标、给素材，
// 流程与平台规则由专家把握；发布/外发动作要求先回显确认，避免 web 一键直发。
export const COMMAND_CATALOG: CommandDef[] = [
  // ── 平台运营 ×5（→ main 路由对应专家包）──
  {
    id: "wx-mp-produce",
    group: "平台运营",
    label: "公众号内容生产",
    description: "公众号（expert-wx-mp）：从选题到成稿的完整内容生产，发布前回显确认。",
    targetAgentId: "main",
    promptTemplate: [
      "公众号运营任务，请走 expert-wx-mp 完整流程：",
      "目标：{{goal}}",
      "素材 / 对标链接：{{material}}",
      "补充要求：{{extra}}",
      "流程和平台规则由你把握；成稿与排版结果先展示给我确认，未经确认不要发布。",
    ].join("\n"),
    params: [
      {
        key: "goal",
        label: "目标 / 主题",
        type: "text",
        required: true,
        description: "想让专家做什么：选题方向、目标人群、期望产出",
        placeholder: "例：写一篇面向独立开发者的 AI 工具评测",
      },
      {
        key: "material",
        label: "素材 / 对标链接",
        type: "text",
        required: false,
        description: "已有素材或对标文章链接，可留空由专家自行调研",
        placeholder: "例：https://mp.weixin.qq.com/s/xxx",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "字数、语气、排版偏好等" },
    ],
  },
  {
    id: "xhs-produce",
    group: "平台运营",
    label: "小红书图文生产",
    description: "小红书（expert-xhs）：对标调研 + 图文笔记生产，发布前回显确认。",
    targetAgentId: "main",
    promptTemplate: [
      "小红书运营任务，请走 expert-xhs 完整流程：",
      "目标：{{goal}}",
      "素材 / 对标笔记链接：{{material}}",
      "补充要求：{{extra}}",
      "对标与平台规则由你把握；笔记成稿先展示给我确认，未经确认不要发布。",
    ].join("\n"),
    params: [
      {
        key: "goal",
        label: "目标 / 主题",
        type: "text",
        required: true,
        description: "笔记选题方向或账号运营目标",
        placeholder: "例：围绕「一人公司工具链」做 3 篇笔记",
      },
      {
        key: "material",
        label: "素材 / 对标笔记链接",
        type: "text",
        required: false,
        description: "对标笔记或素材链接，可留空由专家对标调研",
        placeholder: "例：https://www.xiaohongshu.com/explore/xxx",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "篇数、风格、封面要求等" },
    ],
  },
  {
    id: "douyin-produce",
    group: "平台运营",
    label: "抖音内容生产",
    description: "抖音（expert-douyin）：选题脚本到成片的完整生产，发布前回显确认。",
    targetAgentId: "main",
    promptTemplate: [
      "抖音运营任务，请走 expert-douyin 完整流程：",
      "目标：{{goal}}",
      "素材 / 对标视频链接：{{material}}",
      "补充要求：{{extra}}",
      "拆解与平台规则由你把握；脚本与成片先展示给我确认，未经确认不要发布。",
    ].join("\n"),
    params: [
      {
        key: "goal",
        label: "目标 / 主题",
        type: "text",
        required: true,
        description: "视频选题方向或账号运营目标",
        placeholder: "例：拆解对标账号的爆款结构并复刻一条",
      },
      {
        key: "material",
        label: "素材 / 对标视频链接",
        type: "text",
        required: false,
        description: "对标视频或素材链接，可留空由专家拆解调研",
        placeholder: "例：https://www.douyin.com/video/xxx",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "时长、口播风格等" },
    ],
  },
  {
    id: "wx-channel-produce",
    group: "平台运营",
    label: "视频号内容生产",
    description: "视频号（expert-wx-channel）：选题脚本到制作发布的完整流程，发布前回显确认。",
    targetAgentId: "main",
    promptTemplate: [
      "微信视频号运营任务，请走 expert-wx-channel 完整流程：",
      "目标：{{goal}}",
      "素材 / 对标链接：{{material}}",
      "补充要求：{{extra}}",
      "流程由你把握；脚本与成片先展示给我确认，未经确认不要发布。",
    ].join("\n"),
    params: [
      {
        key: "goal",
        label: "目标 / 主题",
        type: "text",
        required: true,
        description: "视频选题方向或账号运营目标",
        placeholder: "例：做一条产品演示短视频",
      },
      {
        key: "material",
        label: "素材 / 对标链接",
        type: "text",
        required: false,
        description: "对标视频或素材链接，可留空",
        placeholder: "例：视频号或公众号文章链接",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "时长、风格等" },
    ],
  },
  {
    id: "twitter-produce",
    group: "平台运营",
    label: "推特运营",
    description: "X/Twitter（expert-twitter）：冷启动起号 / 诊断 / 发帖编排，发布前回显确认。",
    targetAgentId: "main",
    promptTemplate: [
      "X/Twitter 运营任务，请走 expert-twitter 完整流程：",
      "目标：{{goal}}",
      "素材 / 对标账号：{{material}}",
      "补充要求：{{extra}}",
      "流程由你把握；发帖内容先编排好展示给我确认，未经确认不要发布。",
    ].join("\n"),
    params: [
      {
        key: "goal",
        label: "目标（起号 / 诊断 / 发帖）",
        type: "text",
        required: true,
        description: "冷启动起号、老号诊断或发帖编排",
        placeholder: "例：诊断现有账号并给出重做方案",
      },
      {
        key: "material",
        label: "素材 / 对标账号",
        type: "text",
        required: false,
        description: "对标账号或素材，可留空",
        placeholder: "例：@some_account",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "发帖频率、语言等" },
    ],
  },

  // ── 内容生产 ×3（→ content-producer）──
  {
    id: "video-full",
    group: "内容生产",
    label: "完整视频委托",
    description: "content-producer（video-producer）：从零端到端做一支完整视频。",
    targetAgentId: "content-producer",
    promptTemplate: [
      "视频制作委托，请走 video-producer 端到端流程（脚本→分镜→素材→渲染→自检→交付）：",
      "主题：{{theme}}",
      "目标时长：{{duration}}",
      "风格要求：{{style}}",
      "关键节点（脚本 / 成片）先给我确认再继续。",
    ].join("\n"),
    params: [
      {
        key: "theme",
        label: "视频主题",
        type: "text",
        required: true,
        description: "讲什么、给谁看",
        placeholder: "例：3 分钟讲清楚 MCP 协议",
      },
      {
        key: "duration",
        label: "目标时长",
        type: "choice",
        required: true,
        options: ["1 分钟内", "1-3 分钟", "3-5 分钟", "5 分钟以上"],
        defaultValue: "1-3 分钟",
      },
      {
        key: "style",
        label: "风格要求",
        type: "text",
        required: false,
        description: "画面风格、语气等，可留空由制作者判断",
        placeholder: "例：技术感、快节奏、配字幕",
      },
    ],
  },
  {
    id: "manim-explainer",
    group: "内容生产",
    label: "讲解动画",
    description: "content-producer（manim-explainer）：技术概念 / 图表的可复用讲解动画。",
    targetAgentId: "content-producer",
    promptTemplate: [
      "讲解动画委托，请走 manim-explainer 流程：",
      "要讲清楚的概念 / 图表：{{theme}}",
      "补充要求：{{extra}}",
      "先出视觉方案给我确认，再做渲染。",
    ].join("\n"),
    params: [
      {
        key: "theme",
        label: "概念 / 图表",
        type: "text",
        required: true,
        description: "要可视化的技术概念或数据图表",
        placeholder: "例：动画演示 TCP 三次握手",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "时长、语言等" },
    ],
  },
  {
    id: "design-visual",
    group: "内容生产",
    label: "海报 / 封面生成",
    description: "content-producer（design-full）：海报、封面等平面视觉设计。",
    targetAgentId: "content-producer",
    promptTemplate: [
      "平面视觉委托，请走 design-full 流程：",
      "设计需求：{{brief}}",
      "补充要求：{{extra}}",
      "先出视觉方案（构图 / 配色）给我确认，再交付成稿。",
    ].join("\n"),
    params: [
      {
        key: "brief",
        label: "设计需求（海报 / 封面 / 用途）",
        type: "text",
        required: true,
        description: "设计什么、用在什么场景",
        placeholder: "例：视频号封面，主题「AI 副业指南」",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "尺寸、配色、参考样式" },
    ],
  },

  // ── BD ×2（→ main 路由 expert-bd）──
  {
    id: "bd-find-customers",
    group: "BD",
    label: "找客户 / 评论区截流",
    description: "expert-bd：目标平台找客户、评论区拓展截流，触达前回显确认。",
    targetAgentId: "main",
    promptTemplate: [
      "商务拓展任务，请走 expert-bd 找客户 / 评论区截流流程：",
      "平台：{{platform}}",
      "客户画像 / 品类：{{niche}}",
      "补充要求：{{extra}}",
      "先给我线索清单与截流话术，任何评论 / 私信触达动作先经我确认。",
    ].join("\n"),
    params: [
      {
        key: "platform",
        label: "平台",
        type: "choice",
        required: true,
        options: ["推特", "小红书", "闲鱼"],
        description: "expert-bd 配套互动操作覆盖的平台",
      },
      {
        key: "niche",
        label: "客户画像 / 品类",
        type: "text",
        required: true,
        description: "目标客户是谁、什么行业",
        placeholder: "例：需要搭建知识库的中小 SaaS 团队",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "数量、地域、排除条件" },
    ],
  },
  {
    id: "bd-intel-brief",
    group: "BD",
    label: "商业情报简报",
    description: "expert-bd：指定领域的商业情报采集与简报，只读不动手。",
    targetAgentId: "main",
    promptTemplate: [
      "商业情报任务，请走 expert-bd 情报采集流程：",
      "关注领域 / 竞对：{{focus}}",
      "补充要求：{{extra}}",
      "本次只做采集与简报，不需要任何互动动作；简报发到本会话。",
    ].join("\n"),
    params: [
      {
        key: "focus",
        label: "关注领域 / 竞对",
        type: "text",
        required: true,
        description: "想监测的领域、公司或产品",
        placeholder: "例：AI 编程工具赛道本周动态",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "关注维度、周期等" },
    ],
  },

  // ── IR ×1（→ main 路由 expert-ir）──
  {
    id: "ir-matter",
    group: "IR",
    label: "项目申报 / 投资人跟进",
    description: "expert-ir：项目申报或融资状态机推进。",
    targetAgentId: "main",
    promptTemplate: [
      "投资人关系任务，请走 expert-ir 流程：",
      "事项：{{matter}}",
      "补充要求：{{extra}}",
      "涉及时序与外部沟通的动作先给我方案确认。",
    ].join("\n"),
    params: [
      {
        key: "matter",
        label: "事项（申报 / 投资人 / 融资）",
        type: "text",
        required: true,
        description: "具体申报项目或投资人进展",
        placeholder: "例：跟进某基金 TS 修改意见",
      },
      { key: "extra", label: "补充要求", type: "text", required: false, placeholder: "截止时间、材料要求" },
    ],
  },

  // ── 系统 ×3 ──
  {
    id: "cron-create",
    group: "系统",
    label: "创建定时任务",
    description:
      "让 main 用 cron 工具创建周期任务（web 不直改 cron，P3-E 决议）。自然语言解析有非确定性，发送后请到「定时任务」页核对调度是否如预期。",
    targetAgentId: "main",
    promptTemplate: [
      "请用 cron 工具为我创建一个定时任务：",
      "任务内容：{{task}}",
      "执行节奏：{{schedule}}",
      "创建成功后把任务名、调度计划与 agent 归属回报给我。",
    ].join("\n"),
    params: [
      {
        key: "task",
        label: "任务内容",
        type: "text",
        required: true,
        description: "每次执行时要做什么",
        placeholder: "例：抓取各平台昨日互动数据并写回复盘",
      },
      {
        key: "schedule",
        label: "执行节奏",
        type: "text",
        required: true,
        description: "多久跑一次；创建后到 /cron 核对解析结果",
        placeholder: "例：每天早上 6 点",
      },
    ],
  },
  {
    id: "sys-diagnose",
    group: "系统",
    label: "诊断系统问题",
    description:
      "it-engineer 只读巡检诊断（§10.5 审核定夺：限只读；任何写/重启/配置变更须先征得同意）。",
    targetAgentId: "it-engineer",
    promptTemplate: [
      "系统诊断请求（只读巡检）：{{issue}}",
      "请只做巡检与诊断，给出结论与修复建议；任何写入、重启、凭证 / 配置变更动作，先征得我同意再执行。",
    ].join("\n"),
    params: [
      {
        key: "issue",
        label: "问题现象",
        type: "text",
        required: true,
        description: "看到了什么异常：报错、卡顿、渠道掉线等",
        placeholder: "例：微信渠道今天上午开始收不到消息",
      },
    ],
  },
  {
    id: "relogin",
    group: "系统",
    label: "委托重新登录",
    description:
      "login-manager 有头重新登录平台（仅管辖 douyin/kuaishou/bilibili/xhs-browse；xhs-publish / 公众号请与小贝对话处理）。",
    targetAgentId: "main",
    promptTemplate: [
      "平台登录态异常，请走 login-manager 流程重新登录：",
      "平台：{{platform}}",
      "按 SKILL 纪律执行：有头打开登录页、等我完成手动登录并确认、验证通过后 commit；失败不自动重试。",
    ].join("\n"),
    params: [
      {
        key: "platform",
        label: "平台",
        type: "choice",
        required: true,
        options: ["douyin", "kuaishou", "bilibili", "xhs-browse"],
        description: "login-manager 仅管辖这 4 个平台",
      },
    ],
  },
];

export const COMMAND_IDS = new Set(COMMAND_CATALOG.map((c) => c.id));

export function findCommand(id: string): CommandDef | undefined {
  return COMMAND_CATALOG.find((c) => c.id === id);
}
