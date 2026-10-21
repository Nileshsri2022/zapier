const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const { act } = Renderer;

function loadPublishZap({ captureModal }) {
  const filename = path.resolve(__dirname, '../components/PublishZap.tsx');
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
  const Button = ({ children, onClick, disabled }) =>
    React.createElement('button', { type: 'button', onClick, disabled }, children);
  const ZapCell = ({ index, name, onClick }) =>
    React.createElement('button', { type: 'button', 'data-zap-cell-index': index, onClick }, name);

  const overrides = {
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    './Button': Button,
    './ZapCell': ZapCell,
    axios: {
      get: async () => ({ data: {} }),
      post: async () => ({ data: {} }),
      put: async () => ({ data: {} }),
    },
    'next/navigation': {
      useRouter: () => ({ push() {}, replace() {} }),
      useSearchParams: () => ({ get: () => null }),
    },
    'react-toastify': { toast: { error() {}, success() {} } },
    './Spinner': () => null,
    './Modal': (props) => {
      captureModal(props);
      return React.createElement('div', { 'data-modal-open': String(props.isVisible) });
    },
    './StepConditionsEditor': () => null,
    './FilterBuilder': () => null,
    '@/lib/config': { API_URL: 'https://api.example.test' },
    '@/lib/oauth': { getPendingSelection: () => null },
  };
  mod.require = (name) =>
    Object.hasOwn(overrides, name) ? overrides[name] : Module.prototype.require.call(mod, name);
  mod._compile(js, filename);
  return mod.exports.default;
}

function browserStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('a new editor draft survives a browser refresh before it is published', async (t) => {
  const originalWindow = global.window;
  const originalSessionStorage = global.sessionStorage;
  global.window = {};
  global.sessionStorage = browserStorage();
  t.after(() => {
    global.window = originalWindow;
    global.sessionStorage = originalSessionStorage;
  });

  let modalProps;
  const PublishZap = loadPublishZap({
    captureModal: (props) => {
      modalProps = props;
    },
  });

  let firstView;
  let refreshedView;
  try {
    await act(async () => {
      firstView = Renderer.create(React.createElement(PublishZap));
    });
    await act(async () => {
      firstView.root.findByProps({ 'data-zap-cell-index': 1 }).props.onClick();
    });
    await act(async () => {
      modalProps.onClick({
        id: 'trigger-webhook',
        type: 'Webhook',
        metadata: { authMode: 'none' },
      });
    });
    assert.equal(
      firstView.root.findByProps({ 'data-zap-cell-index': 1 }).children.join(''),
      'Webhook'
    );

    await act(async () => {
      firstView.root.findByProps({ 'data-zap-cell-index': 2 }).props.onClick();
    });
    await act(async () => {
      modalProps.onClick({
        id: 'action-whatsapp-send',
        type: 'WhatsApp Send Message',
        metadata: { kind: 'template', template: { name: 'hello_world' } },
      });
    });
    assert.equal(
      firstView.root.findByProps({ 'data-zap-cell-index': 2 }).children.join(''),
      'WhatsApp Send Message'
    );
    assert.deepEqual(
      JSON.parse(global.sessionStorage.getItem('zapmate_editor_draft')).selectedActions[0].actionMetaData,
      { kind: 'template', template: { name: 'hello_world' } }
    );

    await act(async () => firstView.unmount());

    await act(async () => {
      refreshedView = Renderer.create(React.createElement(PublishZap));
    });

    assert.equal(
      refreshedView.root.findByProps({ 'data-zap-cell-index': 1 }).children.join(''),
      'Webhook',
      'refreshing /editor must restore the in-progress draft instead of starting over'
    );
    assert.equal(
      refreshedView.root.findByProps({ 'data-zap-cell-index': 2 }).children.join(''),
      'WhatsApp Send Message',
      'refreshing /editor must restore the selected action and its metadata'
    );
  } finally {
    if (refreshedView) await act(async () => refreshedView.unmount());
  }
});
