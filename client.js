window.__ModuleLoader__.load({
  id: 'EZAgent',
  factory(require) {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const Button = primitives.Button;
    const Input = primitives.Input;
    const Modal = primitives.Modal;
    const writeClipboard = primitives.writeClipboard;
    const UserIcon = primitives.IconUserOutlineRegular;
    const h = React.createElement;

    const FONT_STACK =
      'Montserrat, var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif)';

    //#region brand
    function BrandName() {
      return h(
        'span',
        {
          'data-ezagent-brand': 'name',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.34em',
            height: 24,
            lineHeight: '24px',
            whiteSpace: 'nowrap',
            fontFamily: FONT_STACK,
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: '0.02em',
            color: 'inherit',
          },
        },
        h('span', { key: 'name' }, 'deepseek'),
        h(
          'span',
          {
            key: 'suffix',
            style: {
              color: '#4d6bfe',
              fontWeight: 500,
            },
          },
          'EZAgent',
        ),
      );
    }
    //#endregion

    //#region EZCloud session client
    // Mirrors the EZSTART Agent desktop login: a username/phone + password login
    // yields an access token, the token is exchanged for a long-lived `sk-` API
    // key named "EZAgent", and the presence of that key is what "signed in"
    // means here.
    //
    // The gateway answers its real responses without `Access-Control-*` headers
    // (only preflight carries them), so the page cannot call it cross-origin.
    // Every request therefore goes to this plugin's host half at
    // `/ezagent/ezcloud/*`, resolved against the page base: the desktop shell
    // forwards `dsh-app://app/…` to the host, so the call stays same-origin.
    const SESSION_STORAGE_KEY = 'ezagent.ezcloud.session.v1';
    const EZCLOUD_ROUTE = 'ezagent/ezcloud/';
    const EZCLOUD_BASE_URL = 'https://api.ezstartai.com';

    const ZH = {
      login: '登录 EZCloud',
      signedInAs: 'EZCloud 账号',
      modalTitle: '登录 EZCloud',
      modalDescription:
        '使用 EZCloud 账号登录；登录后会在账号下创建一个名为 EZAgent 的密钥并保存在本机。',
      account: '账号',
      accountPlaceholder: '用户名 / 手机号',
      password: '密码',
      submit: '登录',
      submitting: '登录中…',
      cancel: '取消',
      close: '关闭',
      done: '完成',
      signOut: '退出登录',
      copy: '复制',
      copied: '已复制',
      displayName: '显示名称',
      group: '用户分组',
      apiKey: 'API Key',
      keyHint: 'DSH 通过该密钥调用 EZCloud，密钥仅保存在本机。',
      errorAccount: '请输入账号',
      errorPassword: '请输入密码',
      errorLogin: '登录失败，请检查账号与密码',
      errorBridge: '无法连接 EZCloud 服务，请检查本机网络',
      errorKey: '无法获取 EZCloud 密钥',
      errorLoad: '无法读取账号信息',
      errorModels: '无法读取模型列表',
      errorBilling: '无法保存计费方式',
      signedTitle: 'EZCloud 账号',
      signedDescription: '账号、钱包与订阅信息来自 EZCloud 实时接口。',
      loading: '加载中…',
      refresh: '刷新',
      walletTitle: '钱包余额',
      balance: '可用余额',
      used: '已消费',
      requests: '请求次数',
      affiliate: '邀请奖励',
      recharge: '充值 / 明细',
      subscriptionTitle: '订阅',
      planManage: '购买 / 管理套餐',
      notSubscribed: '当前账号未订阅套餐，将按钱包余额计费。',
      subscribed: '已订阅',
      validUntil: '有效期至',
      planRemaining: '套餐剩余',
      windowFiveHour: '5 小时窗口',
      windowWeekly: '本周',
      windowMonthly: '本月',
      resetsAt: '重置于',
      billingTitle: '计费方式',
      billingHint: '订阅与钱包余额同时可用时的扣费顺序。',
      prefSubscriptionFirst: '订阅优先',
      prefWalletFirst: '钱包优先',
      prefSubscriptionOnly: '仅订阅',
      prefWalletOnly: '仅钱包',
      modelsTitle: '可用模型',
      modelsCount: '共 {n} 个模型，已同步到 DSH 模型选择器。',
      modelsEmpty: '当前账号没有可用的 EZCloud 模型。',
      modelsOff: 'DSH 模型选择器未接入 EZCloud',
      modelsLoading: '读取模型…',
      modelContext: '{n} 上下文',
      modelImage: '支持图片',
    };

    const EN = {
      login: 'Sign in to EZCloud',
      signedInAs: 'EZCloud account',
      modalTitle: 'Sign in to EZCloud',
      modalDescription:
        'Sign in with your EZCloud account. A key named EZAgent is created on your account and stored on this machine.',
      account: 'Account',
      accountPlaceholder: 'Username or phone number',
      password: 'Password',
      submit: 'Sign in',
      submitting: 'Signing in…',
      cancel: 'Cancel',
      close: 'Close',
      done: 'Done',
      signOut: 'Sign out',
      copy: 'Copy',
      copied: 'Copied',
      displayName: 'Display name',
      group: 'Group',
      apiKey: 'API Key',
      keyHint: 'DSH calls EZCloud with this key. It stays on this machine.',
      errorAccount: 'Enter your account',
      errorPassword: 'Enter your password',
      errorLogin: 'Sign-in failed. Check your account and password.',
      errorBridge: 'Could not reach the EZCloud service. Check this machine\'s network.',
      errorKey: 'Could not obtain an EZCloud key',
      errorLoad: 'Could not read account details',
      errorModels: 'Could not read the model list',
      errorBilling: 'Could not save the billing mode',
      signedTitle: 'EZCloud account',
      signedDescription: 'Account, wallet, and subscription details come from the live EZCloud API.',
      loading: 'Loading…',
      refresh: 'Refresh',
      walletTitle: 'Wallet',
      balance: 'Balance',
      used: 'Spent',
      requests: 'Requests',
      affiliate: 'Invite rewards',
      recharge: 'Top up / details',
      subscriptionTitle: 'Subscription',
      planManage: 'Buy / manage plan',
      notSubscribed: 'No active plan on this account; usage is billed from the wallet balance.',
      subscribed: 'Subscribed',
      validUntil: 'Valid until',
      planRemaining: 'Plan remaining',
      windowFiveHour: '5-hour window',
      windowWeekly: 'This week',
      windowMonthly: 'This month',
      resetsAt: 'Resets',
      billingTitle: 'Billing mode',
      billingHint: 'Which balance is charged first when a plan and the wallet are both available.',
      prefSubscriptionFirst: 'Plan first',
      prefWalletFirst: 'Wallet first',
      prefSubscriptionOnly: 'Plan only',
      prefWalletOnly: 'Wallet only',
      modelsTitle: 'Models',
      modelsCount: '{n} models, synced to the DSH model picker.',
      modelsEmpty: 'This account has no EZCloud models available.',
      modelsOff: 'The DSH model picker is not connected to EZCloud',
      modelsLoading: 'Reading models…',
      modelContext: '{n} context',
      modelImage: 'image input',
    };

    const PREFERENCES = ['subscription_first', 'wallet_first', 'subscription_only', 'wallet_only'];

    function texts() {
      let language = '';
      if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
        language = navigator.language;
      }
      const element = typeof document === 'undefined' ? null : document.documentElement;
      if (element !== null && typeof element.lang === 'string' && element.lang !== '') {
        language = element.lang;
      }
      return language.toLowerCase().startsWith('zh') ? ZH : EN;
    }

    function readSession() {
      try {
        const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (raw === null) return null;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return null;
        if (typeof parsed.apiKey !== 'string' || parsed.apiKey === '') return null;
        return parsed;
      } catch {
        return null;
      }
    }

    function persistSession(session) {
      try {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      } catch {
        /* storage unavailable: the session stays in memory for this page only */
      }
    }

    function clearStoredSession() {
      try {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }

    // The page base, not the origin root: a GUI served under a reverse-proxy
    // directory keeps its prefix, and the desktop page (`dsh-app://app/`) has no
    // addressable origin of its own.
    function hostBase() {
      const fallback = 'http://dsh.internal/';
      const base =
        typeof document === 'undefined' || typeof document.baseURI !== 'string' || document.baseURI === ''
          ? fallback
          : document.baseURI;
      const url = new URL(base, fallback);
      url.search = '';
      url.hash = '';
      if (!url.pathname.endsWith('/')) url.pathname += '/';
      return url;
    }

    function hostUrl(path) {
      return new URL(path.replace(/^\/+/, ''), hostBase()).href;
    }

    // Transport failures are reported with their status and the server's own
    // words: a silent "sign-in failed" hides the difference between a wrong
    // password, an unsigned plugin route, and a rejected cross-origin call.
    async function postHost(path, payload) {
      let response;
      try {
        response = await fetch(hostUrl(`${EZCLOUD_ROUTE}${path}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });
      } catch (failure) {
        const detail = failure instanceof Error && failure.message !== '' ? failure.message : String(failure);
        throw new Error(`${texts().errorBridge}（${detail}）`);
      }
      const text = await response.text();
      let body;
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        body = undefined;
      }
      if (body !== null && typeof body === 'object' && body.ok === true) return body;
      const error = body !== null && typeof body === 'object' ? body.error : undefined;
      const message =
        error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message.trim() : '';
      if (message !== '') throw new Error(message);
      const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 140);
      throw new Error(`HTTP ${response.status}${snippet === '' ? '' : ` · ${snippet}`}`);
    }

    async function signIn(input) {
      const account = String(input.account === undefined || input.account === null ? '' : input.account).trim();
      const password = String(input.password === undefined || input.password === null ? '' : input.password);
      if (account === '') throw new Error(texts().errorAccount);
      if (password === '') throw new Error(texts().errorPassword);

      const body = await postHost('sign-in', { account, password });
      const issued = body.session;
      if (issued === null || typeof issued !== 'object') throw new Error(texts().errorKey);
      if (typeof issued.apiKey !== 'string' || issued.apiKey === '') throw new Error(texts().errorKey);
      // Only what the UI needs is kept: the key itself, who it belongs to, and
      // the device key that revokes the login. The dashboard access token and
      // session id stay out of browser storage.
      const session = {
        version: 1,
        baseUrl: issued.baseUrl,
        userId: issued.userId,
        username: issued.username,
        displayName: issued.displayName,
        group: issued.group,
        apiKey: issued.apiKey,
        apiKeyId: issued.apiKeyId,
        apiKeyName: issued.apiKeyName,
        deviceKey: issued.deviceKey,
        signedInAt: issued.signedInAt,
      };
      persistSession(session);
      return session;
    }

    async function signOut(session) {
      clearStoredSession();
      if (session === null || typeof session !== 'object') return;
      if (typeof session.deviceKey !== 'string' || session.deviceKey === '') return;
      try {
        await postHost('sign-out', { deviceKey: session.deviceKey });
      } catch {
        /* the local session is gone either way; revocation is best effort */
      }
    }

    /** Tell the host which account is live so it can serve the model picker. */
    async function syncHost(session) {
      try {
        await postHost('sync', { session });
      } catch {
        /* the host re-syncs on the next page load */
      }
    }

    async function loadSnapshot(session) {
      const body = await postHost('account', { session });
      const snapshot = body.snapshot;
      if (snapshot === null || typeof snapshot !== 'object') throw new Error(texts().errorLoad);
      return snapshot;
    }

    async function loadModels(session, refresh) {
      const body = await postHost('models', refresh === true ? { session, refresh: true } : { session });
      return Array.isArray(body.models) ? body.models : [];
    }

    async function savePreference(session, preference) {
      await postHost('billing-preference', { session, preference });
      return preference;
    }

    function maskKey(key) {
      if (typeof key !== 'string' || key.length <= 10) return '••••••••';
      return `${key.slice(0, 6)}••••••${key.slice(-4)}`;
    }

    function formatCredits(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return '0';
      if (numeric >= 100) return numeric.toFixed(0);
      if (numeric >= 10) return numeric.toFixed(1);
      if (numeric >= 1) return numeric.toFixed(2);
      return numeric.toFixed(3);
    }

    function formatCount(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return '0';
      return new Intl.NumberFormat().format(Math.round(numeric));
    }

    function formatDate(seconds) {
      const numeric = Number(seconds);
      if (!Number.isFinite(numeric) || numeric <= 0) return '—';
      return new Date(numeric * 1000).toLocaleDateString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }

    function formatDateTime(seconds) {
      const numeric = Number(seconds);
      if (!Number.isFinite(numeric) || numeric <= 0) return '—';
      return new Date(numeric * 1000).toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function formatTokens(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return '';
      if (numeric >= 1000000) return `${Math.round(numeric / 100000) / 10}M`;
      if (numeric >= 1024) return `${Math.round(numeric / 1024)}K`;
      return String(Math.round(numeric));
    }

    function descriptionOf(model) {
      const description = model.description;
      if (description === null || typeof description !== 'object') return '';
      if (typeof description.zh === 'string' && description.zh !== '') return description.zh;
      return typeof description.en === 'string' ? description.en : '';
    }

    function initialOf(label) {
      const text = String(label === undefined || label === null ? '' : label).trim();
      return text === '' ? 'E' : text.slice(0, 1).toUpperCase();
    }
    //#endregion

    //#region styles
    const STYLE_ELEMENT_ID = 'ezagent-styles';
    const CSS = `
.ezagent-foot-row{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:18px;cursor:pointer;text-align:left;transition:background-color .12s ease;}
.ezagent-foot-row[data-wide="false"]{justify-content:center;padding:0;}
.ezagent-foot-row:hover{background:color-mix(in srgb,currentColor 10%,transparent);}
.ezagent-foot-row:focus-visible{outline:2px solid color-mix(in srgb,currentColor 45%,transparent);outline-offset:1px;}
.ezagent-foot-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ezagent-avatar{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:18px;border-radius:50%;background:#4d6bfe;color:#fff;font-size:11px;font-weight:600;line-height:1;}
.ezagent-form{display:flex;flex-direction:column;gap:14px;}
.ezagent-field{display:flex;flex-direction:column;gap:6px;}
.ezagent-field-label{font-size:12px;color:color-mix(in srgb,currentColor 62%,transparent);}
.ezagent-input{width:100%;}
.ezagent-input input{width:100%;}
.ezagent-error{margin:0;font-size:12px;line-height:18px;color:#d64545;}
.ezagent-rows{display:flex;flex-direction:column;gap:12px;}
.ezagent-row{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:13px;line-height:20px;}
.ezagent-row-label{flex:none;color:color-mix(in srgb,currentColor 62%,transparent);}
.ezagent-row-value{display:inline-flex;align-items:center;gap:8px;min-width:0;}
.ezagent-row-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ezagent-key{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;letter-spacing:.02em;}
.ezagent-modal{width:min(720px,100%);max-height:min(88vh,920px);}
.ezagent-modal-content{min-height:0;overflow-y:auto;}
.ezagent-dialog{display:flex;flex-direction:column;gap:14px;max-height:min(62vh,560px);overflow:auto;padding-right:4px;}
.ezagent-card{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid color-mix(in srgb,currentColor 12%,transparent);border-radius:12px;}
.ezagent-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.ezagent-card-title{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:color-mix(in srgb,currentColor 55%,transparent);}
.ezagent-balance{display:flex;align-items:baseline;gap:6px;}
.ezagent-balance-value{font-size:28px;font-weight:600;line-height:1.1;letter-spacing:-.01em;}
.ezagent-balance-unit{font-size:13px;color:color-mix(in srgb,currentColor 55%,transparent);}
.ezagent-stats{display:flex;flex-wrap:wrap;gap:18px;}
.ezagent-stat{display:flex;flex-direction:column;gap:2px;}
.ezagent-stat-label{font-size:11px;color:color-mix(in srgb,currentColor 55%,transparent);}
.ezagent-stat-value{font-size:13px;font-weight:500;}
.ezagent-muted{margin:0;font-size:12px;line-height:18px;color:color-mix(in srgb,currentColor 55%,transparent);}
.ezagent-plan-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
.ezagent-plan-title{font-size:15px;font-weight:600;}
.ezagent-badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:6px;background:color-mix(in srgb,#4d6bfe 18%,transparent);color:#4d6bfe;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;}
.ezagent-badge[data-tone="muted"]{background:color-mix(in srgb,currentColor 10%,transparent);color:color-mix(in srgb,currentColor 60%,transparent);}
.ezagent-usage{display:flex;flex-direction:column;gap:5px;}
.ezagent-usage-head{display:flex;justify-content:space-between;gap:12px;font-size:12px;}
.ezagent-usage-foot{font-size:11px;color:color-mix(in srgb,currentColor 45%,transparent);}
.ezagent-bar{height:6px;overflow:hidden;border-radius:999px;background:color-mix(in srgb,currentColor 10%,transparent);}
.ezagent-bar-fill{height:100%;border-radius:999px;background:#4d6bfe;transition:width .2s ease;}
.ezagent-chips{display:flex;flex-wrap:wrap;gap:6px;}
.ezagent-models{display:flex;flex-direction:column;max-height:190px;overflow:auto;}
.ezagent-model{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid color-mix(in srgb,currentColor 7%,transparent);}
.ezagent-model:last-child{border-bottom:0;}
.ezagent-model-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;}
.ezagent-model-meta{flex:none;font-size:11px;color:color-mix(in srgb,currentColor 50%,transparent);}
.ezagent-link{color:#4d6bfe;font-size:12px;text-decoration:none;}
.ezagent-link:hover{text-decoration:underline;}
.ezagent-identity{display:flex;align-items:center;gap:10px;}
.ezagent-identity .ezagent-avatar{width:32px;height:32px;font-size:14px;}
.ezagent-identity-name{display:flex;flex-direction:column;gap:1px;min-width:0;}
.ezagent-identity-name strong{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ezagent-identity-name span{font-size:11px;color:color-mix(in srgb,currentColor 55%,transparent);}
`;

    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ELEMENT_ID) !== null) return;
      const style = document.createElement('style');
      style.id = STYLE_ELEMENT_ID;
      style.textContent = CSS;
      document.head.append(style);
    }
    //#endregion

    //#region shared components
    function Field(props) {
      return h(
        'label',
        { className: 'ezagent-field' },
        h('span', { className: 'ezagent-field-label' }, props.label),
        h(Input, {
          className: 'ezagent-input',
          type: props.type === undefined ? 'text' : props.type,
          value: props.value,
          placeholder: props.placeholder,
          autoComplete: props.autoComplete,
          spellCheck: false,
          disabled: props.disabled === true,
          'aria-label': props.label,
          onChange: (event) => props.onChange(event.currentTarget.value),
        }),
      );
    }

    function Row(props) {
      return h(
        'div',
        { className: 'ezagent-row' },
        h('span', { className: 'ezagent-row-label' }, props.label),
        h('span', { className: 'ezagent-row-value' }, props.children),
      );
    }

    function Card(props) {
      return h(
        'section',
        { className: 'ezagent-card' },
        h(
          'div',
          { className: 'ezagent-card-head' },
          h('h3', { className: 'ezagent-card-title' }, props.title),
          props.extra === undefined ? null : props.extra,
        ),
        props.children,
      );
    }

    function Stat(props) {
      return h(
        'div',
        { className: 'ezagent-stat' },
        h('span', { className: 'ezagent-stat-label' }, props.label),
        h('span', { className: 'ezagent-stat-value' }, props.value),
      );
    }

    function UsageBar(props) {
      const t = texts();
      const window = props.window;
      const percent = Math.max(0, Math.min(100, Number(window.percent) || 0));
      return h(
        'div',
        { className: 'ezagent-usage' },
        h(
          'div',
          { className: 'ezagent-usage-head' },
          h('span', null, props.label),
          h('span', { className: 'ezagent-muted' }, `${formatCredits(window.used)} / ${formatCredits(window.limit)} E`),
        ),
        h('div', { className: 'ezagent-bar' }, h('div', { className: 'ezagent-bar-fill', style: { width: `${percent}%` } })),
        window.resetAt > 0
          ? h('div', { className: 'ezagent-usage-foot' }, `${t.resetsAt} ${formatDateTime(window.resetAt)}`)
          : null,
      );
    }
    //#endregion

    //#region sign-in dialog
    function SignInDialog(props) {
      const t = texts();
      const [account, setAccount] = React.useState('');
      const [password, setPassword] = React.useState('');
      const [error, setError] = React.useState('');
      const [pending, setPending] = React.useState(false);

      React.useEffect(() => {
        if (props.open) return;
        setAccount('');
        setPassword('');
        setError('');
        setPending(false);
      }, [props.open]);

      const submit = async (event) => {
        if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault();
        if (pending) return;
        setPending(true);
        setError('');
        try {
          const next = await signIn({ account, password });
          setPassword('');
          props.onSessionChange(next);
        } catch (failure) {
          setError(failure instanceof Error && failure.message !== '' ? failure.message : t.errorLogin);
        } finally {
          setPending(false);
        }
      };

      return h(Modal, {
        open: props.open,
        className: 'ezagent-modal',
        title: t.modalTitle,
        description: t.modalDescription,
        closeLabel: t.close,
        onClose: pending ? () => {} : props.onClose,
        footer: h(
          React.Fragment,
          null,
          h(Button, { key: 'cancel', variant: 'outline', disabled: pending, onClick: props.onClose }, t.cancel),
          h(Button, { key: 'submit', variant: 'primary', disabled: pending, onClick: submit }, pending ? t.submitting : t.submit),
        ),
        children: h(
          'form',
          { className: 'ezagent-form', onSubmit: submit },
          h(Field, {
            key: 'account',
            label: t.account,
            placeholder: t.accountPlaceholder,
            autoComplete: 'username',
            value: account,
            disabled: pending,
            onChange: setAccount,
          }),
          h(Field, {
            key: 'password',
            label: t.password,
            type: 'password',
            autoComplete: 'current-password',
            value: password,
            disabled: pending,
            onChange: setPassword,
          }),
          error === '' ? null : h('p', { key: 'error', className: 'ezagent-error', role: 'alert' }, error),
          h('button', { key: 'submit-helper', type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' }),
        ),
      });
    }
    //#endregion

    //#region account dialog
    function AccountDialog(props) {
      const t = texts();
      const session = props.session;
      const [snapshot, setSnapshot] = React.useState(null);
      const [models, setModels] = React.useState(null);
      const [host, setHost] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [modelsLoading, setModelsLoading] = React.useState(false);
      const [error, setError] = React.useState('');
      const [modelsError, setModelsError] = React.useState('');
      const [copied, setCopied] = React.useState(false);
      const [pending, setPending] = React.useState('');
      const [preference, setPreference] = React.useState('');

      const readAccount = React.useRef(null);
      readAccount.current = async () => {
        setLoading(true);
        setError('');
        try {
          const next = await loadSnapshot(session);
          setSnapshot(next);
          const subscription = next.subscription === null || typeof next.subscription !== 'object' ? null : next.subscription;
          setPreference(subscription === null ? '' : subscription.billingPreference);
        } catch (failure) {
          setError(failure instanceof Error && failure.message !== '' ? failure.message : t.errorLoad);
        } finally {
          setLoading(false);
        }
      };

      const readModels = React.useRef(null);
      readModels.current = async (refresh) => {
        setModelsLoading(true);
        setModelsError('');
        try {
          setModels(await loadModels(session, refresh === true));
        } catch (failure) {
          setModelsError(failure instanceof Error && failure.message !== '' ? failure.message : t.errorModels);
        } finally {
          setModelsLoading(false);
        }
      };

      React.useEffect(() => {
        if (!props.open) return;
        readAccount.current();
        readModels.current(false);
        postHost('diagnostics', {})
          .then((body) => setHost(body))
          .catch(() => setHost(null));
      }, [props.open, session.apiKey]);

      React.useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timer);
      }, [copied]);

      const copyKey = async () => {
        try {
          const done = await writeClipboard(session.apiKey);
          if (done) setCopied(true);
        } catch {
          /* clipboard permission missing: nothing to report */
        }
      };

      const handleSignOut = async () => {
        if (pending !== '') return;
        setPending('sign-out');
        const current = session;
        try {
          await signOut(current);
        } finally {
          setPending('');
          props.onSessionChange(null);
        }
      };

      const changePreference = async (value) => {
        if (pending !== '' || value === preference) return;
        setPending('billing');
        setError('');
        try {
          setPreference(await savePreference(session, value));
        } catch (failure) {
          setError(failure instanceof Error && failure.message !== '' ? failure.message : t.errorBilling);
        } finally {
          setPending('');
        }
      };

      const wallet = snapshot === null ? null : snapshot.wallet;
      const subscription = snapshot === null ? null : snapshot.subscription;
      const plan = subscription !== null && typeof subscription === 'object' && subscription.active === true ? subscription.plan : null;
      const usage = subscription !== null && typeof subscription === 'object' && subscription.active === true ? subscription.usage : null;
      const account = snapshot === null ? null : snapshot.account;
      const walletUrl = snapshot !== null && typeof snapshot.baseUrl === 'string' ? `${snapshot.baseUrl}/wallet` : `${EZCLOUD_BASE_URL}/wallet`;
      const planUrl = snapshot !== null && typeof snapshot.baseUrl === 'string' ? `${snapshot.baseUrl}/subscription` : `${EZCLOUD_BASE_URL}/subscription`;
      const label = session.displayName !== '' ? session.displayName : session.username;

      const preferenceLabels = {
        subscription_first: t.prefSubscriptionFirst,
        wallet_first: t.prefWalletFirst,
        subscription_only: t.prefSubscriptionOnly,
        wallet_only: t.prefWalletOnly,
      };

      const body = h(
        'div',
        { className: 'ezagent-dialog' },
        h(
          'div',
          { className: 'ezagent-identity', key: 'identity' },
          h('span', { className: 'ezagent-avatar', 'aria-hidden': 'true' }, initialOf(label)),
          h(
            'div',
            { className: 'ezagent-identity-name' },
            h('strong', null, label),
            h(
              'span',
              null,
              [account !== null && account.group !== '' ? account.group : session.group, session.username]
                .filter((part) => typeof part === 'string' && part !== '')
                .join(' · '),
            ),
          ),
        ),

        error === '' ? null : h('p', { key: 'error', className: 'ezagent-error', role: 'alert' }, error),

        wallet === null
          ? null
          : h(
              Card,
              {
                key: 'wallet',
                title: t.walletTitle,
                extra: h('a', { className: 'ezagent-link', href: walletUrl, target: '_blank', rel: 'noreferrer' }, t.recharge),
              },
              h(
                'div',
                { className: 'ezagent-balance' },
                h('span', { className: 'ezagent-balance-value' }, loading && snapshot === null ? '—' : formatCredits(wallet.credits)),
                h('span', { className: 'ezagent-balance-unit' }, 'E'),
              ),
              h(
                'div',
                { className: 'ezagent-stats' },
                h(Stat, { key: 'used', label: t.used, value: `${formatCredits(wallet.usedCredits)} E` }),
                h(Stat, { key: 'requests', label: t.requests, value: formatCount(wallet.requestCount) }),
                wallet.affiliateCredits > 0
                  ? h(Stat, {
                      key: 'affiliate',
                      label: t.affiliate,
                      value: `${formatCredits(wallet.affiliateCredits)} E · ${formatCount(wallet.affiliateCount)}`,
                    })
                  : null,
              ),
            ),

        h(
          Card,
          { key: 'subscription', title: t.subscriptionTitle, extra: h('a', { className: 'ezagent-link', href: planUrl, target: '_blank', rel: 'noreferrer' }, t.planManage) },
          subscription === null
            ? h('p', { className: 'ezagent-muted' }, loading ? t.loading : t.errorLoad)
            : plan === null
              ? h('p', { className: 'ezagent-muted' }, t.notSubscribed)
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'ezagent-plan-head' },
                    h('span', { className: 'ezagent-plan-title' }, plan.title === '' ? t.subscribed : plan.title),
                    plan.level === '' ? null : h('span', { className: 'ezagent-badge' }, plan.level),
                    plan.endTime > 0
                      ? h('span', { className: 'ezagent-badge', 'data-tone': 'muted' }, `${t.validUntil} ${formatDate(plan.endTime)}`)
                      : null,
                  ),
                  plan.subtitle === '' ? null : h('p', { className: 'ezagent-muted' }, plan.subtitle),
                  h(
                    'div',
                    { className: 'ezagent-stats' },
                    h(Stat, { key: 'remaining', label: t.planRemaining, value: `${formatCredits(plan.remaining)} / ${formatCredits(plan.total)} E` }),
                  ),
                  usage === null
                    ? null
                    : h(
                        React.Fragment,
                        null,
                        usage.fiveHour === null ? null : h(UsageBar, { key: 'five', label: t.windowFiveHour, window: usage.fiveHour }),
                        usage.weekly === null ? null : h(UsageBar, { key: 'week', label: t.windowWeekly, window: usage.weekly }),
                        usage.monthly === null ? null : h(UsageBar, { key: 'month', label: t.windowMonthly, window: usage.monthly }),
                      ),
                ),
        ),

        snapshot === null
          ? null
          : h(
              Card,
              { key: 'billing', title: t.billingTitle },
              h('p', { className: 'ezagent-muted' }, t.billingHint),
              h(
                'div',
                { className: 'ezagent-chips' },
                PREFERENCES.map((value) =>
                  h(
                    Button,
                    {
                      key: value,
                      variant: value === preference ? 'primary' : 'outline',
                      size: 'sm',
                      disabled: pending !== '',
                      onClick: () => changePreference(value),
                    },
                    preferenceLabels[value],
                  ),
                ),
              ),
            ),

        h(
          Card,
          {
            key: 'models',
            title: t.modelsTitle,
            extra: h(
              Button,
              { variant: 'ghost', size: 'sm', disabled: modelsLoading, onClick: () => readModels.current(true) },
              modelsLoading ? t.loading : t.refresh,
            ),
          },
          modelsError !== ''
            ? h('p', { className: 'ezagent-error' }, modelsError)
            : models === null
              ? h('p', { className: 'ezagent-muted' }, t.modelsLoading)
              : models.length === 0
                ? h('p', { className: 'ezagent-muted' }, t.modelsEmpty)
                : h(
                    React.Fragment,
                    null,
                    h('p', { className: 'ezagent-muted' }, t.modelsCount.replace('{n}', String(models.length))),
                    h(
                      'div',
                      { className: 'ezagent-models' },
                      models.map((model) => {
                        const description = descriptionOf(model);
                        const meta = [
                          model.vendor === '' ? '' : model.vendor,
                          formatTokens(model.contextWindow) === '' ? '' : t.modelContext.replace('{n}', formatTokens(model.contextWindow)),
                          Array.isArray(model.input) && model.input.includes('image') ? t.modelImage : '',
                        ]
                          .filter((part) => part !== '')
                          .join(' · ');
                        return h(
                          'div',
                          { className: 'ezagent-model', key: model.id, title: description.slice(0, 400) },
                          h('code', { className: 'ezagent-model-name' }, model.id),
                          h('span', { className: 'ezagent-model-meta' }, meta),
                        );
                      }),
                    ),
                  ),
          host !== null && typeof host === 'object' && host.registered === false
            ? h(
                'p',
                { className: 'ezagent-muted' },
                typeof host.adapterError === 'string' && host.adapterError !== ''
                  ? `${t.modelsOff} · ${host.adapterError}`
                  : t.modelsOff,
              )
            : null,
        ),

        h(
          Row,
          { key: 'key', label: t.apiKey },
          h('code', { className: 'ezagent-key' }, maskKey(session.apiKey)),
          h(Button, { variant: 'ghost', size: 'sm', disabled: pending !== '', onClick: copyKey }, copied ? t.copied : t.copy),
        ),
        h('p', { key: 'key-hint', className: 'ezagent-muted' }, t.keyHint),
      );

      return h(Modal, {
        open: props.open,
        className: 'ezagent-modal',
        title: t.signedTitle,
        description: t.signedDescription,
        closeLabel: t.close,
        onClose: props.onClose,
        footer: h(
          React.Fragment,
          null,
          h(Button, { key: 'signout', variant: 'outline', disabled: pending !== '', onClick: handleSignOut }, t.signOut),
          h(Button, { key: 'done', variant: 'primary', onClick: props.onClose }, t.done),
        ),
        children: body,
      });
    }
    //#endregion

    //#region sidebar entry
    function LoginEntry(props) {
      const t = texts();
      const wide = props.wide !== false;
      const [session, setSession] = React.useState(readSession);
      const [open, setOpen] = React.useState(false);

      React.useEffect(() => ensureStyles(), []);

      // A page reload keeps the stored session, but the host keeps its copy in
      // memory only: announce the session again so the model picker and account
      // calls work without a second sign-in.
      React.useEffect(() => {
        syncHost(session);
      }, [session]);

      const label = session === null ? t.login : session.displayName || session.username || 'EZCloud';

      // Signing out returns to the signed-out state, so the open dialog closes
      // instead of turning into the sign-in form.
      const changeSession = (next) => {
        setSession(next);
        if (next === null) setOpen(false);
      };

      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            key: 'trigger',
            type: 'button',
            className: 'ezagent-foot-row',
            'data-wide': wide ? 'true' : 'false',
            'data-ezagent-login': session === null ? 'signed-out' : 'signed-in',
            title: session === null ? t.login : `${t.signedInAs} · ${label}`,
            'aria-label': session === null ? t.login : `${t.signedInAs}: ${label}`,
            onClick: () => setOpen(true),
          },
          session === null
            ? h(UserIcon, { key: 'icon', size: wide ? 16 : 18 })
            : h('span', { key: 'avatar', className: 'ezagent-avatar', 'aria-hidden': 'true' }, initialOf(label)),
          wide ? h('span', { key: 'label', className: 'ezagent-foot-label' }, label) : null,
        ),
        session === null
          ? h(SignInDialog, {
              key: 'sign-in',
              open,
              onClose: () => setOpen(false),
              onSessionChange: changeSession,
            })
          : h(AccountDialog, {
              key: 'account',
              open,
              session,
              onClose: () => setOpen(false),
              onSessionChange: changeSession,
            }),
      );
    }
    //#endregion

    return {
      inject: ['slots'],
      apply(ctx) {
        // The shipped official wordmark is a single occupant of this slot. A
        // lower priority sorts ahead of it, so this occupant wins the cell.
        ctx.slots.inject('sidebar.brand.name', () =>
          ctx.slots.register(
            { name: 'sidebar.brand.name', priority: -1 },
            BrandName,
          ),
        );
        // Footer action list: sits directly above the Settings seat, so the
        // EZCloud account entry reads as part of the left menu.
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'ezagent-login', priority: 0 },
            LoginEntry,
          ),
        );
      },
      // Public surface for host-side or scripted use; the UI above is the
      // primary entry point.
      ezcloud: {
        defaultBaseUrl: EZCLOUD_BASE_URL,
        route: EZCLOUD_ROUTE,
        readSession,
        signIn,
        signOut,
        syncHost,
        loadSnapshot,
        loadModels,
      },
    };
  },
});
