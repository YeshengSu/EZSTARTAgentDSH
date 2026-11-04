# EZCloud 嵌入 DSH 模型选择器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 DSH 自带的模型选择器显示 EZCloud 的推理等级、每行 E 消耗徽标与悬浮详情，且全部走官方扩展点。

**Architecture:** 宿主端在 `resolveModel` 里广告 `reasoning.efforts`，在请求体里白名单式写入 `reasoning_effort`，并让 `/models` 路由多返回价格字段；客户端注册 `conversation.input.model.label` 子槽组件，用插件自己的 `/models` 缓存渲染徽标与悬浮卡。不替换任何内置组件。

**Tech Stack:** Node ESM 插件（宿主半边 `index.js`）、浏览器端 `client.js`（`window.__ModuleLoader__` + React 元素）、现有 `%TEMP%\ezagent-harness` 测试夹具。

**Spec:** [docs/superpowers/specs/2026-11-04-ezcloud-picker-embed-design.md](../../specs/2026-11-04-ezcloud-picker-embed-design.md)

## Global Constraints

- 版本号从 `1.4.2` 升到 `1.5.0`（`index.js` 的 `PLUGIN_VERSION` 与 `package.json` 的 `version` 同步）。
- 不新增运行时依赖；客户端只能 require `react` 和 `@deepseek-ai/dsh-client-ui-primitives`。
- 推理等级只允许 `low` / `medium` / `high` 三个值进入请求体；其它值一律不发送。
- 不替换 `conversation.input.model` 槽，不实现 tab。
- 任何新 UI 的失败都必须退化成"只显示模型名"，不得抛错到槽里。
- 测试夹具沿用 `%TEMP%\ezagent-harness`（`host.test.mjs`、`client.smoke.mjs`），运行前 `index.js`/`client.js` 要复制成 `host.mjs`/`client.mjs`；每次运行前把 `DSH_HOME` 指到新的临时目录。
- 修改完成后同步到 `C:\Users\Administrator\Documents\deepseek-harness\default-workspace\EZAgent`（DSH 实际加载的副本）。

## Review Focus

- 非 EZCloud 的 provider（deepseek、opencode-go）也会经过我们的 label 组件：用户期望它们看起来和原来完全一样，只有 EZCloud 行才有徽标。
- 模型在 DSH 目录里存在、但插件 `/models` 缓存里没有（刚登录失败、刷新中）：用户期望看到名字，而不是空白或报错。
- 上层传来的 `reasoningEffort` 可能是任意字符串：不能出现除 low/medium/high 以外的值进入请求体，否则网关会静默改路由。
- 未登录 EZCloud 时选择器仍然渲染：不能因此发起请求风暴或抛未捕获异常。
- 悬浮卡在菜单底部弹出时：不能被滚动容器裁掉，也不能顶出视口。

---

### Task 1: 宿主广告推理等级

**Files:**
- Modify: `index.js`（常量区约 82-86 行；`EzCloudAdapter.resolveModel` 约 844-862 行）
- Test: `C:\Users\Administrator\AppData\Local\Temp\ezagent-harness\host.test.mjs`

**Interfaces:**
- Produces: `REASONING_EFFORTS: {id: 'low'|'medium'|'high', name: string}[]`、`DEFAULT_REASONING_EFFORT: 'high'`；`resolveModel()` 返回值新增 `reasoning: { efforts: {id,name}[], defaultEffort: string }`。

- [ ] **Step 1: 写失败测试**

在 `host.test.mjs` 第 3 节（`resolveModel` 断言处）追加：

```js
assert.deepEqual(info.reasoning.efforts.map((effort) => effort.id), ['low', 'medium', 'high']);
assert.equal(info.reasoning.defaultEffort, 'high');
assert.equal(new Set(info.reasoning.efforts.map((effort) => effort.id)).size, 3);
assert.ok(info.reasoning.efforts.every((effort) => effort.name.length > 0));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node "$env:TEMP\ezagent-harness\host.test.mjs"`
Expected: FAIL，`Cannot read properties of undefined (reading 'efforts')`

- [ ] **Step 3: 实现**

`index.js` 常量区（`DEFAULT_MAX_TOKENS` 附近）加：

```js
/** Reasoning levels the gateway accepts; anything else must never be sent. */
const REASONING_EFFORTS = [
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
];
const DEFAULT_REASONING_EFFORT = 'high';
```

`resolveModel` 的返回对象里补一项（放在 `defaultMaxTokens` 之后）：

```js
reasoning: {
  efforts: REASONING_EFFORTS.map((effort) => ({ ...effort })),
  defaultEffort: DEFAULT_REASONING_EFFORT,
},
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node "$env:TEMP\ezagent-harness\host.test.mjs"`
Expected: `host harness: all assertions passed`

- [ ] **Step 5: 提交**

```bash
git add index.js
git commit -m "feat: advertise EZCloud reasoning levels"
```

---

### Task 2: 只发送合法的 reasoning_effort

**Files:**
- Modify: `index.js`（`buildRequest` 约 968-1030 行，`body` 组装处）
- Test: `C:\Users\Administrator\AppData\Local\Temp\ezagent-harness\host.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `REASONING_EFFORTS`。
- Produces: `REASONING_EFFORT_IDS: Set<string>`；`buildRequest` 在 `options.reasoningEffort` 属于该集合时写入 `body.reasoning_effort`。

- [ ] **Step 1: 写失败测试**

在 `host.test.mjs` 第 5 节（流式断言）之后追加：

```js
// 11. Only accepted effort ids reach the wire; an unknown id is dropped, because
// the gateway silently reroutes unknown values to a different model.
const effortBodies = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  effortBodies.push(JSON.parse(init.body));
  return originalFetch(url, init);
};
for await (const _chunk of adapter.stream({ provider: 'ezcloud', model: 'GPT-6.1-Sol', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], maxTokens: 16, reasoningEffort: 'high' })) void _chunk;
for await (const _chunk of adapter.stream({ provider: 'ezcloud', model: 'GPT-6.1-Sol', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], maxTokens: 16, reasoningEffort: 'ultra' })) void _chunk;
for await (const _chunk of adapter.stream({ provider: 'ezcloud', model: 'GPT-6.1-Sol', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], maxTokens: 16 })) void _chunk;
globalThis.fetch = originalFetch;
assert.equal(effortBodies[0].reasoning_effort, 'high');
assert.equal('reasoning_effort' in effortBodies[1], false);
assert.equal('reasoning_effort' in effortBodies[2], false);
```

注意：这段代码放在文件末尾会与第 9 节退出登录冲突，因此实际插入位置在第 9 节之前（会话仍有效时）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node "$env:TEMP\ezagent-harness\host.test.mjs"`
Expected: FAIL，`actual: undefined, expected: 'high'`

- [ ] **Step 3: 实现**

`index.js` 常量区加：

```js
const REASONING_EFFORT_IDS = new Set(REASONING_EFFORTS.map((effort) => effort.id));
```

`buildRequest` 的 `body` 组装处（`stop` 之后）加：

```js
if (typeof options.reasoningEffort === 'string' && REASONING_EFFORT_IDS.has(options.reasoningEffort)) {
  body.reasoning_effort = options.reasoningEffort;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node "$env:TEMP\ezagent-harness\host.test.mjs"`
Expected: `host harness: all assertions passed`

- [ ] **Step 5: 提交**

```bash
git add index.js
git commit -m "feat: forward only the accepted reasoning effort"
```

---

### Task 3: /models 返回价格字段

**Files:**
- Modify: `index.js`（`modelCatalog` 约 533-544 行；`/models` 路由约 1256-1276 行）
- Test: `C:\Users\Administrator\AppData\Local\Temp\ezagent-harness\host.test.mjs`

**Interfaces:**
- Produces: `modelCatalog()` 条目新增 `avgCredits: number`、`completionRatio: number`、`billingMode: string`；`/models` 响应新增 `avgCredits`、`completionRatio`、`billingMode`、`maxTokens`。

- [ ] **Step 1: 写失败测试**

在 `host.test.mjs` 的 `PRICING` 夹具里给 `GPT-6.1-Sol` 行补 `avg_credits: 37500, completion_ratio: 2, billing_mode: 'per_token'`，然后在第 4 节之后追加：

```js
// 4b. The picker badge needs the per-call price, which the DSH catalog drops.
const priced = await post('/ezagent/ezcloud/models', { session });
assert.equal(priced.json.ok, true);
const pricedModel = priced.json.models.find((model) => model.id === 'GPT-6.1-Sol');
assert.equal(pricedModel.avgCredits, 37500);
assert.equal(pricedModel.credits, 0.0375);
assert.equal(pricedModel.completionRatio, 2);
assert.equal(pricedModel.billingMode, 'per_token');
assert.ok(Number.isInteger(pricedModel.maxTokens) && pricedModel.maxTokens > 0);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node "$env:TEMP\ezagent-harness\host.test.mjs"`
Expected: FAIL，`actual: undefined, expected: 37500`

- [ ] **Step 3: 实现**

`modelCatalog` 的 `entries.push({...})` 里补：

```js
avgCredits: Number(row.avg_credits) > 0 ? Number(row.avg_credits) : 0,
completionRatio: Number(row.completion_ratio) > 0 ? Number(row.completion_ratio) : 0,
billingMode: typeof row.billing_mode === 'string' ? row.billing_mode : '',
```

`/models` 路由的 `models.map(...)` 里补：

```js
avgCredits: entry.avgCredits,
completionRatio: entry.completionRatio,
billingMode: entry.billingMode,
maxTokens: entry.maxTokens,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node "$env:TEMP\ezagent-harness\host.test.mjs"`
Expected: `host harness: all assertions passed`

- [ ] **Step 5: 提交**

```bash
git add index.js
git commit -m "feat: expose per-call pricing to the picker"
```

---

### Task 4: 客户端 label 组件骨架与注册

**Files:**
- Modify: `client.js`（`apply` 约 1061-1081 行；新增组件放在 `//#region` 区之前）
- Test: `C:\Users\Administrator\AppData\Local\Temp\ezagent-harness\client.smoke.mjs`

**Interfaces:**
- Produces: `ModelLabel({ provider, model, placement, selected })` 组件；`slots` 注册项 `{ name: 'conversation.input.model.label', id: 'ezagent-model-label', priority: 0 }`；导出 `ezcloud.labelText(model)` 供测试使用。
- Consumes: `h`、`React`（已有）。

- [ ] **Step 1: 写失败测试**

在 `client.smoke.mjs` 的 `readPickerCatalog` 断言之后追加：

```js
// The label seat must be claimed, and a non-EZCloud row must render the plain name.
const labelSlots = [];
mod.apply({
  slots: {
    inject(_name, fn) { fn(); },
    register(spec, component) { labelSlots.push({ spec, component }); return {}; },
  },
});
const label = labelSlots.find((entry) => entry.spec.name === 'conversation.input.model.label');
assert.ok(label, 'the plugin must claim the model label slot');
assert.equal(label.spec.id, 'ezagent-model-label');
const plainTree = label.component({
  provider: { id: 'opencode-go', name: 'opencode-go' },
  model: { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
  placement: 'option',
  selected: false,
});
assert.equal(walk(plainTree).some((node) => node.children === 'GPT-6.1-Sol'), true);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node "$env:TEMP\ezagent-harness\client.smoke.mjs"`
Expected: FAIL，`the plugin must claim the model label slot`

- [ ] **Step 3: 实现**

`client.js` 中新增（放在 `//#region DSH model catalog probe` 之前）：

```js
//#region model label
// The picker renders this component for every provider's rows; only EZCloud
// rows get decoration, everything else must look exactly like it did before.
const LABEL_PROVIDER = 'ezcloud';

function labelText(model) {
  return model !== null && typeof model === 'object' && typeof model.name === 'string' && model.name !== ''
    ? model.name
    : typeof model?.id === 'string' ? model.id : '';
}

function ModelLabel(props) {
  return h('span', { 'data-ezagent-label': 'name' }, labelText(props?.model));
}
//#endregion
```

`apply` 里追加注册：

```js
ctx.slots.inject('conversation.input.model.label', () =>
  ctx.slots.register(
    { name: 'conversation.input.model.label', id: 'ezagent-model-label', priority: 0 },
    ModelLabel,
  ),
);
```

`ezcloud` 导出对象里加 `labelText`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node "$env:TEMP\ezagent-harness\client.smoke.mjs"`
Expected: `client smoke: all assertions passed`

- [ ] **Step 5: 提交**

```bash
git add client.js
git commit -m "feat: claim the model label seat"
```

---

### Task 5: E 徽标与悬浮卡

**Files:**
- Modify: `client.js`（Task 4 的区域；`loadModels` 复用）
- Test: `C:\Users\Administrator\AppData\Local\Temp\ezagent-harness\client.smoke.mjs`

**Interfaces:**
- Consumes: Task 3 的 `/models` 字段。
- Produces: `priceBadge(entry) -> string`、`formatCredits(value) -> string`、`cardPosition(rect, height, viewportHeight) -> {left: number, top: number}`、`forgetLabelCatalog() -> void`、`ModelLabel` 渲染 `data-ezagent-badge` 与悬浮卡 `data-ezagent-card`；模块级缓存 `labelCatalog = { at: number, byId: Map }`。

- [ ] **Step 1: 写失败测试**

```js
assert.equal(mod.ezcloud.formatCredits(37500), '37,500');
assert.equal(mod.ezcloud.formatCredits(0.0375), '0.0375');
assert.equal(mod.ezcloud.priceBadge({ quotaType: 0, avgCredits: 37500, credits: 0.0375 }), 'E 37500/次');
assert.equal(mod.ezcloud.priceBadge({ quotaType: 1, avgCredits: 0, credits: 0.5 }), 'E 0.5/1M');
assert.equal(mod.ezcloud.priceBadge({ quotaType: 0, avgCredits: 0, credits: 0 }), '');
```

以及无数据退化与悬浮卡定位：

```js
const bareTree = label.component({
  provider: { id: 'ezcloud', name: 'EZCloud' },
  model: { id: 'Claude-Opus-5', name: 'Claude-Opus-5' },
  placement: 'option',
  selected: false,
});
assert.equal(walk(bareTree).some((node) => node.children === 'Claude-Opus-5'), true);
assert.equal(walk(bareTree).some((node) => node.props?.['data-ezagent-badge'] !== undefined), false);

// Signed out: no session means no request at all.
store.delete('ezagent.ezcloud.session.v1');
let fetched = 0;
const countingFetch = sandbox.fetch;
sandbox.fetch = async () => { fetched += 1; throw new Error('offline'); };
mod.ezcloud.forgetLabelCatalog();
mod.ezcloud.priceBadge({ quotaType: 0, avgCredits: 1, credits: 1 });
assert.equal(fetched, 0);

// The card flips down instead of leaving the viewport when the row sits high up.
assert.deepEqual(mod.ezcloud.cardPosition({ top: 200, bottom: 220, left: 40 }, 120, 800), { left: 40, top: 72 });
assert.deepEqual(mod.ezcloud.cardPosition({ top: 40, bottom: 60, left: 40 }, 120, 800), { left: 40, top: 68 });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node "$env:TEMP\ezagent-harness\client.smoke.mjs"`
Expected: FAIL，`mod.ezcloud.formatCredits is not a function`

- [ ] **Step 3: 实现**

`client.js` 的 `//#region model label` 内实现：

- `formatCredits(value)`：`Number` 无效或 ≤0 返回 `''`；≥1000 用 `toLocaleString('en-US')` 千分位；否则保留最多 4 位小数并去尾零。
- `priceBadge(entry)`：`quotaType === 1` 用 `credits` 生成 `E <n>/1M`，否则用 `avgCredits` 生成 `E <n>/次`；两者都为 0 返回 `''`。
- 缓存：`let labelCatalog = { at: 0, byId: new Map() }`；`async function ensureLabelCatalog()` 在超过 5 分钟或为空时调用 `loadModels(readSession())`，失败静默保留旧缓存；`readSession()` 为 `null` 时直接返回、不发请求；`forgetLabelCatalog()` 把缓存重置为 `{ at: 0, byId: new Map() }`。
- `cardPosition(rect, height, viewportHeight)`：优先向上，`above = rect.top - 8 - height`；`above >= 8` 返回 `{ left: rect.left, top: above }`，否则返回 `{ left: rect.left, top: rect.bottom + 8 }`。
- `ModelLabel`：`useEffect` 里调用 `ensureLabelCatalog().then(...)`；`useState` 保存 `byId` 与 `hover`；`provider.id !== 'ezcloud'` 直接返回纯名字；有徽标时渲染 `<span data-ezagent-badge>`；`hover` 为真时渲染 `<div data-ezagent-card style={{position:'fixed', left, top}}>`，内容为供应商、简介、上下文/最大输出、参考价（标注"参考价"）。
- 悬浮：`onMouseEnter` 用 `event.currentTarget.getBoundingClientRect()` 取 `{top, bottom, left}`，按 `cardPosition(rect, 120, window.innerHeight)` 定位，卡片向上展开、贴顶时翻转到下方；`onMouseLeave` 清除。

- [ ] **Step 4: 跑测试确认通过**

Run: `node "$env:TEMP\ezagent-harness\client.smoke.mjs"`
Expected: `client smoke: all assertions passed`

- [ ] **Step 5: 提交**

```bash
git add client.js
git commit -m "feat: show E pricing and a hover card in the picker"
```

---

### Task 6: 版本、文档、同步与人工验证

**Files:**
- Modify: `index.js:70`、`package.json:3`、`README.md`
- Sync: `C:\Users\Administrator\Documents\deepseek-harness\default-workspace\EZAgent\`

**Interfaces:**
- Consumes: 前五个任务的全部产物。

- [ ] **Step 1: 提升版本**

`index.js` 的 `const PLUGIN_VERSION = '1.4.2';` 改为 `'1.5.0'`；`package.json` 的 `"version"` 同步为 `1.5.0`。

- [ ] **Step 2: 更新 README**

在模型相关章节补一段：模型选择器里的 EZCloud 分组会显示推理等级（低/中/高）、每行 E 消耗徽标与悬停详情；说明价格是目录参考价。

- [ ] **Step 3: 全量回归**

```bash
node "$env:TEMP\ezagent-harness\host.test.mjs"
node "$env:TEMP\ezagent-harness\host.late-llm.test.mjs"
node "$env:TEMP\ezagent-harness\host.nollm.test.mjs"
node "$env:TEMP\ezagent-harness\client.smoke.mjs"
node --check index.js
node --check client.js
```

Expected: 四个 `all assertions passed` + 两个检查无输出。（跑 host 测试前把 `index.js` 复制成 `host.mjs`、把 `DSH_HOME` 指到新的临时目录。）

- [ ] **Step 4: 同步到 DSH 实际加载的副本**

```powershell
Copy-Item E:\Codes\EZSTARTAgentDSH\index.js,E:\Codes\EZSTARTAgentDSH\client.js,E:\Codes\EZSTARTAgentDSH\package.json,E:\Codes\EZSTARTAgentDSH\README.md 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\EZAgent' -Force
```

然后比对 `Get-FileHash`，四个文件哈希必须一致。

- [ ] **Step 5: 人工验证（需要重启 DSH）**

重启 DSH 后打开模型选择器：EZCloud 分组内每行应有 `E …` 徽标；悬停出现卡片；选中一个 EZCloud 模型后「推理等级」面板有低/中/高，切换后能正常对话。记录到 `%USERPROFILE%\.dsh\ezagent-diag.log` 的 `listModels: N models` 仍应存在。

- [ ] **Step 6: 提交**

```bash
git add index.js client.js package.json README.md
git commit -m "chore: release 1.5.0"
```
