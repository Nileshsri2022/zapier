const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

/**
 * The web suite runs under node:test rather than a browser. Render the public
 * dashboard page with its browser boundaries stubbed, then execute its mount
 * effect. This keeps the auth assertion at the page seam: routing and network
 * behaviour, rather than an implementation detail of getSessionDetails.
 */
function renderDashboard({ session, get = async () => ({ data: { data: { zaps: [], total: 0 } } }) }) {
  const effects = [];
  const requests = [];
  const redirects = [];
  const removedStorageKeys = [];
  const toastErrors = [];
  const filename = join(__dirname, '../app/dashboard/page.tsx');
  const source = readFileSync(filename, 'utf8');
  const originalLoad = Module._load;
  const originalLocalStorage = global.localStorage;

  global.localStorage = {
    removeItem(key) {
      removedStorageKeys.push(key);
    },
  };

  Module._load = function loadDashboardDependency(request, parent, isMain) {
    switch (request) {
      case 'react':
        return {
          useEffect(effect) {
            effects.push(effect);
          },
          useState(initialValue) {
            return [initialValue, () => {}];
          },
        };
      case 'react/jsx-runtime':
        return {
          Fragment: Symbol('Fragment'),
          jsx() {
            return null;
          },
          jsxs() {
            return null;
          },
        };
      case 'axios':
        return {
          get(...args) {
            requests.push(args);
            return get(...args);
          },
        };
      case 'next/navigation':
        return {
          useRouter() {
            return {
              push() {},
              replace(path) {
                redirects.push(path);
              },
            };
          },
        };
      case 'react-toastify':
        return {
          toast: {
            error(message) {
              toastErrors.push(message);
            },
            info() {},
            success() {},
          },
        };
      case '../../helper':
        return { getSessionDetails: () => session };
      case '@/lib/config':
        return { API_URL: 'https://api.example.test', HOOKS_URL: 'https://hooks.example.test' };
      case '@/lib/webhookUrl':
        return { webhookUrlFor: () => null };
      case '@/lib/appIcon':
        return { appIcon: () => '' };
      default:
        if (
          [
            '@/components/MainSection',
            '@/components/Button',
            '@/components/Spinner',
            'next/link',
            '@/components/Tooltip',
            '@/components/ZapRunHistory',
          ].includes(request)
        ) {
          return () => null;
        }
        return originalLoad.call(this, request, parent, isMain);
    }
  };

  try {
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(join(__dirname, '..'));
    loaded._compile(output, filename);
    loaded.exports.default();
  } finally {
    Module._load = originalLoad;
  }

  return {
    async runMountEffect() {
      assert.equal(effects.length, 1, 'dashboard should register one mount effect');
      await effects[0]();
    },
    cleanup() {
      global.localStorage = originalLocalStorage;
    },
    redirects,
    requests,
    removedStorageKeys,
    toastErrors,
  };
}

test('redirects a visitor without a local session to login before requesting Zaps', async () => {
  const dashboard = renderDashboard({ session: { isLoggedIn: false, user: null } });

  try {
    await dashboard.runMountEffect();

    assert.deepEqual(dashboard.redirects, ['/login']);
    assert.equal(dashboard.requests.length, 0);
    assert.deepEqual(dashboard.toastErrors, []);
  } finally {
    dashboard.cleanup();
  }
});

for (const status of [401, 403]) {
  test(`clears a stale local session and redirects when the Zap request returns ${status}`, async () => {
    const dashboard = renderDashboard({
      session: { isLoggedIn: true, user: { id: 1 } },
      get: async () => {
        throw { response: { status } };
      },
    });

    try {
      await dashboard.runMountEffect();

      assert.equal(dashboard.requests.length, 1);
      assert.deepEqual(dashboard.removedStorageKeys, ['user']);
      assert.deepEqual(dashboard.redirects, ['/login']);
      assert.deepEqual(dashboard.toastErrors, []);
    } finally {
      dashboard.cleanup();
    }
  });
}
