# EZCloud 嵌入 DSH 模型选择器 — 设计

日期：2026-11-04
状态：待确认

## 1. 意图

EZAgent 插件已经能把 EZCloud 的模型注册进 DSH 的模型选择器，但选择器里看到的只是一行行名字：没有推理等级可选，看不出每次调用要花多少 E，也看不到模型到底擅长什么。

目标是把 EZCloud 的模型信息**嵌入** DSH 自带的选择器，而不是替换它：DSH 以后更新选择器（搜索、快捷键、加载态、可访问性），我们自动继承。

## 2. 目标

- 选择器里出现 `EZCloud` 分组，模型可被选中（已实现，本设计只保证不破坏）。
- 选中 EZCloud 模型后，菜单里的「推理等级」有可选档位，且档位真的会传到 EZCloud。
- 每个 EZCloud 模型行显示 E 消耗徽标；鼠标悬停显示卡片：供应商、简介、上下文/最大输出、输入输出单价。
- 全部通过 DSH 官方扩展点实现，不 fork、不替换任何内置组件。

## 3. 非目标

- 不做左侧 tab（已与用户确认放弃；DSH 的选择器没有 tab 扩展点）。
- 不替换 `conversation.input.model` 插槽里的内置组件。
- 不实现套餐购买、余额充值等账号操作。

## 4. 约束（实测得出）

1. **DSH 的分类目录会丢弃未知字段。** `llm.listModels` / `resolveModelInfo` 只保留 `provider/id/name/description/inputModalities/context/defaultMaxTokens/reasoning/...`，我们自定义的价格字段传不过去。价格必须走插件自己的 HTTP 路由。
2. **选择器只开放三个扩展点**：provider 分组、`reasoning.efforts`、`conversation.input.model.label` 子槽。模型列表区域没有 tab / 分组过滤槽。
3. **网关对非法的 `reasoning_effort` 会静默改路由。** 实测：`reasoning_effort: "minimal"` / `"ultra"` 或 `thinking: {...}` 的请求返回 200，但 `model` 变成了 `deepseek-flash`——不是报错，是换了一个模型回答。因此只能发送网关接受的值。
4. **网关接受 `low` / `medium` / `high` 且确实影响思考量。** 实测 Claude-Opus-5：`high` → 150 reasoning tokens，`medium` → 41，`low` → 0；同样的请求不带该字段时模型按自身的自适应思考行为处理。
5. **不同模型是否"真的思考"由模型自己决定**，比如 Kimi-K3 有 reasoning tokens，GLM-5.3 没有，但两者都接受参数且都不会被改路由。

## 5. 方案

### 5.1 宿主端（`index.js`）

- `EzCloudAdapter.resolveModel` 增加 `reasoning: { efforts, defaultEffort }`；`efforts` 的 `id/name` 非空且唯一（注册表会校验）。
- `stream(options)` 读取 `options.reasoningEffort`，仅当值属于 `{low, medium, high}` 时写入请求体 `reasoning_effort`，其余情况**不发送**该字段（避免约束 3 的静默改路由）。
- `/ezagent/ezcloud/models` 返回的条目补充价格字段：`avgCredits`（按次计费 E 值）、`credits`（每百万 token 输入价）、`completionRatio`、`billingMode`。客户端用它渲染徽标与悬浮卡。

### 5.2 客户端（`client.js`）

- 注册 `conversation.input.model.label` 子槽组件，props 为 `{provider, model, placement, selected}`。
- 渲染：模型名 + `E` 徽标（仅 EZCloud 模型）；`placement` 为 `trigger` 时只显示名字与当前档位，避免触发器过宽。
- 悬停：用 `getBoundingClientRect()` 定位的自绘卡片（`position: fixed`，向上展开，贴边时翻转），内容取插件自己的 `/models` 缓存；数据缺失时退回纯文本，不报错。
- 组件内部做错误边界：任何异常都渲染成纯模型名，绝不抛到槽里（抛错会被槽 abdicate，模型控件会整个消失）。

### 5.3 数据流

```
选择器 → conversation.input.model.label(我们的组件)
            ├─ 模型名/当前选择：DSH 传入的 model / provider
            └─ 价格、简介、上下文：postHost('models') 缓存（按 model.id 关联）
```

## 6. 关键决定

| 决定 | 选择 | 理由 |
| --- | --- | --- |
| 推理等级覆盖面 | 所有 EZCloud 文本模型都提供 `low/medium/high`，默认 `high` | 网关对这三个值全局接受；是否真的思考由模型决定，提供档位不会造成改路由风险 |
| 非法档位 | 一律不发 | 见约束 3，宁可退回模型默认行为 |
| 价格单位 | 按次计费显示 `E x/次`，按 token 计费显示 `E x/1M` | 与 `/api/pricing` 的 `quota_type` 语义一致 |
| 悬浮卡实现 | 自绘 fixed 定位卡片 | 原生 `title` 延迟长且不能排版；条目在滚动容器里，absolute 会被裁剪 |
| 失败退化 | 任何一步失败都退回"只有模型名" | 不能因为增强信息让选择器变丑或消失 |

## 7. 验证

- 宿主单测：`resolveModel` 返回的 efforts 通过注册表校验（复用现有 strict fake）；`stream` 在 effort 合法时带上字段、非法时不带（断言请求体）。
- 实测：用真实会话对 Claude-Opus-5 分别以 high/low 发起一次请求，确认 `reasoning_tokens` 有差异、`model` 未被改成 `deepseek-flash`。
- 客户端：现有 smoke 测试加入 label 组件的渲染断言（有价格 → 显示徽标；无数据 → 纯名字）。
- 人工：重启 DSH 后在选择器里看到 EZCloud 分组、行内 E 徽标、悬停卡片、推理等级面板可选。

## 8. 风险

- 网关可能调整 `reasoning_effort` 的接受值或模型覆盖范围；届时表现为"档位无效"或"改路由"。缓解：只发三值 + 单测锁定请求体。
- `conversation.input.model.label` 的 props 形态若在 DSH 升级中改变，徽标会消失（退回纯名字），但选择器本身不受影响。
- 价格是目录快照，可能与实际计费有偏差；卡片里标注"参考价"。
