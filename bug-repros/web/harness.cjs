/**
 * Shared harness for the editor (apps/web) bug repros.
 *
 * Mirrors apps/web/tests/ai-form.test.cjs: transpile the TSX with the TypeScript
 * compiler API, compile it into a synthetic CommonJS module whose `require` can
 * be overridden, then render it with react-test-renderer. Kept in bug-repros/
 * (outside apps/web) so `cd apps/web && bun run test` and `eslint .` in that app
 * stay untouched while these RED probes live on the branch.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const { act } = Renderer;

function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, relative);
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (name) =>
    Object.hasOwn(overrides, name) ? overrides[name] : Module.prototype.require.call(mod, name);
  mod._compile(js, filename);
  return mod.exports;
}

/** Stub metadata forms: each renders a marker plus a Save button that reports its data. */
function metadataStubs(spy) {
  const make = (name) => {
    const Component = ({ handleClick }) =>
      React.createElement(
        'div',
        { className: 'meta-stub', 'data-form': name },
        React.createElement(
          'button',
          {
            type: 'button',
            className: `save-${name}`,
            onClick: () => {
              spy(name);
              handleClick({ __form: name });
            },
          },
          `Save ${name}`
        )
      );
    Component.displayName = name;
    return Component;
  };
  return {
    __esModule: true,
    AiMetaData: make('AiMetaData'),
    EmailMetaData: make('EmailMetaData'),
    SolanaMetaData: make('SolanaMetaData'),
    WebhookMetaData: make('WebhookMetaData'),
    GmailMetaData: make('GmailMetaData'),
    GoogleSheetsMetaData: make('GoogleSheetsMetaData'),
    GoogleCalendarMetaData: make('GoogleCalendarMetaData'),
    ScheduleMetaData: make('ScheduleMetaData'),
    GitHubMetaData: make('GitHubMetaData'),
  };
}

/**
 * Render the editor Modal.
 * @param {object} opts
 * @param {number} opts.isVisible 1 = trigger modal, >1 = action modal (step index)
 * @param {Array}  opts.triggers  GET /api/triggers  -> { avialableTriggers }
 * @param {Array}  opts.actions   GET /api/actions   -> { availableActions }
 * @param {Record<string, any>} opts.endpoints extra GET responses keyed by path
 */
async function renderModal(opts) {
  const { isVisible = 1, triggers = [], actions = [], endpoints = {} } = opts;
  const requests = [];
  const results = [];
  const savedForms = [];

  const axios = {
    get: async (url) => {
      requests.push({ method: 'GET', url });
      if (url.endsWith('/api/triggers')) return { data: { avialableTriggers: triggers } };
      if (url.endsWith('/api/actions')) return { data: { availableActions: actions } };
      const hit = Object.keys(endpoints).find((key) => url.endsWith(key));
      if (hit) return { data: endpoints[hit] };
      throw new Error(`Unexpected GET ${url}`);
    },
    post: async (url, body) => {
      requests.push({ method: 'POST', url, body });
      const hit = Object.keys(endpoints).find((key) => url.endsWith(key));
      if (hit) return { data: endpoints[hit] };
      return { data: {} };
    },
  };

  const Modal = load('../../apps/web/components/Modal.tsx', {
    axios,
    'react-toastify': { toast: { error: () => {}, success: () => {} } },
    '@/lib/config': { API_URL: '' },
    '@/lib/oauth': { redirectToOAuth: () => {}, savePendingSelection: () => {} },
    './modal/types': {},
    '@repo/types': {},
    './modal/constants': load('../../apps/web/components/modal/constants.ts'),
    './metadata': metadataStubs((name) => savedForms.push(name)),
  }).default;

  let view;
  await act(async () => {
    view = Renderer.create(
      React.createElement(Modal, {
        isVisible,
        setIsVisible: () => {},
        onClick: (item) => results.push(item),
      })
    );
  });

  const root = () => view.root;
  const all = (pred) => root().findAll(pred, { deep: true });
  const buttons = () => all((n) => n.type === 'button');
  const buttonByText = (text) =>
    buttons().find((b) => textOf(b).trim().toLowerCase() === text.toLowerCase());
  const buttonByClass = (className) =>
    buttons().find((b) => String(b.props.className || '').includes(className));
  const select = () => all((n) => n.type === 'select');
  const notices = () =>
    all((n) => String(n.props.className || '') === 'modal-notice').map(textOf);
  const forms = () =>
    all((n) => String(n.props.className || '') === 'meta-stub').map(
      (n) => n.props['data-form']
    );

  function textOf(node) {
    try {
      return node.children
        .map((c) => (typeof c === 'string' ? c : c.children ? textOf(c) : ''))
        .join('');
    } catch {
      return '';
    }
  }

  const clickApp = async (name) => {
    const app = buttons().find((b) => textOf(b).trim() === name);
    if (!app) throw new Error(`App button not found: ${name} (have: ${buttons().map(textOf).join('|')})`);
    await act(async () => {
      app.props.onClick({ target: {}, currentTarget: {}, preventDefault() {}, stopPropagation() {} });
    });
  };

  const chooseEvent = async (type) => {
    const dropdown = select().find((s) =>
      s.children.some((o) => typeof o === 'object' && textOf(o).trim() === type)
    );
    if (!dropdown) throw new Error(`Event dropdown not found for ${type}`);
    const option = dropdown.children.find((o) => typeof o === 'object' && textOf(o).trim() === type);
    await act(async () => {
      dropdown.props.onChange({ target: { value: option.props.value } });
    });
  };

  const click = async (button) => {
    await act(async () => {
      button.props.onClick({ target: {}, currentTarget: {}, preventDefault() {}, stopPropagation() {} });
    });
  };

  const unmount = () => act(() => view.unmount());

  return {
    view,
    root,
    all,
    buttons,
    buttonByText,
    buttonByClass,
    select,
    notices,
    forms,
    textOf,
    clickApp,
    chooseEvent,
    click,
    requests,
    results,
    savedForms,
    unmount,
  };
}

module.exports = { load, renderModal, React, Renderer, act };
