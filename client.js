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
      copying: '复制',
      copied: '已复制',
      displayName: '显示名称',
      apiKey: 'API Key',
      errorAccount: '请输入账号',
      errorPassword: '请输入密码',
      errorLogin: '登录失败，请检查账号与密码',
      errorBridge: '无法连接 EZCloud 服务，请检查本机网络',
      errorKey: '无法获取 EZCloud 密钥',
      signedTitle: 'EZCloud 账号',
      signedDescription: '已连接 EZCloud，密钥保存在本机。',
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
      copying: 'Copy',
      copied: 'Copied',
      displayName: 'Display name',
      apiKey: 'API Key',
      errorAccount: 'Enter your account',
      errorPassword: 'Enter your password',
      errorLogin: 'Sign-in failed. Check your account and password.',
      errorBridge: 'Could not reach the EZCloud service. Check this machine\'s network.',
      errorKey: 'Could not obtain an EZCloud key',
      signedTitle: 'EZCloud account',
      signedDescription: 'Connected to EZCloud. The key is stored on this machine.',
    };

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

    async function postHost(path, payload) {
      let response;
      try {
        response = await fetch(hostUrl(`${EZCLOUD_ROUTE}${path}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });
      } catch {
        throw new Error(texts().errorBridge);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      if (body !== null && typeof body === 'object' && body.ok === true) return body;
      const error = body !== null && typeof body === 'object' ? body.error : undefined;
      const message =
        error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message.trim() : '';
      throw new Error(message === '' ? texts().errorLogin : message);
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

    function maskKey(key) {
      if (typeof key !== 'string' || key.length <= 10) return '••••••••';
      return `${key.slice(0, 6)}••••••${key.slice(-4)}`;
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

    //#region components
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

    function initialOf(label) {
      const text = String(label === undefined || label === null ? '' : label).trim();
      return text === '' ? 'E' : text.slice(0, 1).toUpperCase();
    }

    function LoginDialog(props) {
      const t = texts();
      const session = props.session;
      const [account, setAccount] = React.useState('');
      const [password, setPassword] = React.useState('');
      const [error, setError] = React.useState('');
      const [pending, setPending] = React.useState(false);
      const [copied, setCopied] = React.useState(false);

      React.useEffect(() => {
        if (props.open) return;
        setAccount('');
        setPassword('');
        setError('');
        setPending(false);
        setCopied(false);
      }, [props.open]);

      React.useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timer);
      }, [copied]);

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

      const copyKey = async () => {
        if (session === null) return;
        const done = await writeClipboard(session.apiKey);
        if (done) setCopied(true);
      };

      const handleSignOut = async () => {
        if (pending) return;
        setPending(true);
        const current = session;
        props.onSessionChange(null);
        try {
          await signOut(current);
        } finally {
          setPending(false);
          setError('');
        }
      };

      if (session === null) {
        return h(
          Modal,
          {
            open: props.open,
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
          },
        );
      }

      return h(
        Modal,
        {
          open: props.open,
          title: t.signedTitle,
          description: t.signedDescription,
          closeLabel: t.close,
          onClose: props.onClose,
          footer: h(
            React.Fragment,
            null,
            h(Button, { key: 'signout', variant: 'outline', disabled: pending, onClick: handleSignOut }, t.signOut),
            h(Button, { key: 'done', variant: 'primary', onClick: props.onClose }, t.done),
          ),
          children: h(
            'div',
            { className: 'ezagent-rows' },
            h(Row, { key: 'account', label: t.account }, h('span', { className: 'ezagent-row-text' }, session.username)),
            session.displayName === ''
              ? null
              : h(
                  Row,
                  { key: 'display', label: t.displayName },
                  h('span', { className: 'ezagent-row-text' }, session.displayName),
                ),
            h(
              Row,
              { key: 'key', label: t.apiKey },
              h('code', { className: 'ezagent-key' }, maskKey(session.apiKey)),
              h(Button, { variant: 'ghost', size: 'sm', disabled: pending, onClick: copyKey }, copied ? t.copied : t.copying),
            ),
          ),
        },
      );
    }

    function LoginEntry(props) {
      const t = texts();
      const wide = props.wide !== false;
      const [session, setSession] = React.useState(readSession);
      const [open, setOpen] = React.useState(false);

      React.useEffect(() => ensureStyles(), []);

      const label = session === null ? t.login : session.displayName || session.username || 'EZCloud';

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
        h(LoginDialog, {
          key: 'dialog',
          open,
          session,
          onClose: () => setOpen(false),
          onSessionChange: setSession,
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
      },
    };
  },
});
