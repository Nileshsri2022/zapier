const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const ts = require('typescript');
const Module = require('node:module');

function loadGoogleSheetsMetaData(overrides = {}) {
  const filename = path.resolve(__dirname, '../components/metadata/GoogleSheetsMetaData.tsx');
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
  mod.require = (name) => {
    if (overrides[name]) return overrides[name];
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name.includes('FormInput'))
      return (props) =>
        React.createElement('input', {
          ...props,
          'data-testid': props.name,
        });
    if (name.includes('Button'))
      return (props) =>
        React.createElement(
          'button',
          {
            ...props,
            'data-testid': 'form-button',
            'aria-disabled': props.disabled ? 'true' : 'false',
          },
          props.children
        );
    if (name.includes('config')) return { API_URL: 'https://api.test' };
    if (name.includes('oauth')) return { redirectToOAuth: () => {} };
    if (name === 'react-toastify') return { toast: { error: () => {}, success: () => {} } };
    if (name === 'axios') return { get: async () => ({ data: { servers: [] } }) };
    return require(name);
  };
  mod._compile(js, filename);
  return mod.exports;
}

test('Slice 3.1: extractSpreadsheetId extracts ID from full Google Sheets URL or raw ID string', () => {
  const { extractSpreadsheetId } = loadGoogleSheetsMetaData();
  assert.equal(typeof extractSpreadsheetId, 'function');

  // Full URL variations
  assert.equal(
    extractSpreadsheetId(
      'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'
    ),
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
  );
  assert.equal(
    extractSpreadsheetId('http://docs.google.com/spreadsheets/d/abc-123_XYZ/edit?usp=sharing'),
    'abc-123_XYZ'
  );
  assert.equal(extractSpreadsheetId('docs.google.com/spreadsheets/d/test_id_456'), 'test_id_456');

  // Raw ID with whitespace
  assert.equal(
    extractSpreadsheetId('   1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms   '),
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
  );
  assert.equal(extractSpreadsheetId('raw-sheet-id-789'), 'raw-sheet-id-789');
  assert.equal(extractSpreadsheetId(''), '');
});

test('Slice 3.2: Component rendering when no Google Sheets accounts are connected', () => {
  const { GoogleSheetsMetaData } = loadGoogleSheetsMetaData();

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(GoogleSheetsMetaData, {
      selectedType: 'Google Sheets - New or Updated Row',
      handleClick: () => {},
      initialServers: [],
      initialLoading: false,
    })
  );

  // Connect warning and CTA button
  assert.ok(html.includes('Connect Google Sheets'));
  assert.ok(html.includes('You need to connect your Google account'));
  assert.ok(html.includes('Connect Google Account'));
  // Does not show spreadsheet input or save button
  assert.equal(html.includes('Spreadsheet ID'), false);
  assert.equal(html.includes('Save'), false);
});

test('Slice 3.3: Component rendering when single Google account is connected', () => {
  const { GoogleSheetsMetaData } = loadGoogleSheetsMetaData();

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(GoogleSheetsMetaData, {
      selectedType: 'Google Sheets - New or Updated Row',
      handleClick: () => {},
      initialServers: [{ id: 'server-1', email: 'user@gmail.com' }],
      initialLoading: false,
    })
  );

  // Inputs are rendered
  assert.ok(html.includes('Spreadsheet ID'));
  assert.ok(html.includes('Sheet Name'));
  assert.ok(html.includes('docs.google.com/spreadsheets/d/'));
  assert.ok(html.includes('Save'));
  // Single account does not render select dropdown
  assert.equal(html.includes('<select'), false);
});

test('Slice 3.4: Account picker rendered when multiple Google accounts are connected', () => {
  const { GoogleSheetsMetaData } = loadGoogleSheetsMetaData();

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(GoogleSheetsMetaData, {
      selectedType: 'Google Sheets - New or Updated Row',
      handleClick: () => {},
      initialServers: [
        { id: 'server-1', email: 'primary@gmail.com' },
        { id: 'server-2', email: 'secondary@gmail.com' },
      ],
      initialLoading: false,
    })
  );

  assert.ok(html.includes('<select'));
  assert.ok(html.includes('primary@gmail.com'));
  assert.ok(html.includes('secondary@gmail.com'));
});

test('Slice 3.5: Component rehydration with initialData and preSelectedServerId', () => {
  const { GoogleSheetsMetaData } = loadGoogleSheetsMetaData();

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(GoogleSheetsMetaData, {
      selectedType: 'Google Sheets - New or Updated Row',
      handleClick: () => {},
      preSelectedServerId: 'server-2',
      initialServers: [
        { id: 'server-1', email: 'primary@gmail.com' },
        { id: 'server-2', email: 'secondary@gmail.com' },
      ],
      initialData: {
        spreadsheetId: 'rehydrated-sheet-123',
        sheetName: 'Orders 2026',
        serverId: 'server-2',
      },
      initialLoading: false,
    })
  );

  assert.ok(html.includes('rehydrated-sheet-123'));
  assert.ok(html.includes('Orders 2026'));
  assert.ok(html.includes('Save'));
});

test('Slice 3.6: Save button is disabled (canSave: false) when spreadsheetId is empty', () => {
  const { GoogleSheetsMetaData } = loadGoogleSheetsMetaData();

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(GoogleSheetsMetaData, {
      selectedType: 'Google Sheets - New or Updated Row',
      handleClick: () => {},
      initialServers: [{ id: 'server-1', email: 'user@gmail.com' }],
      initialData: {
        spreadsheetId: '',
        sheetName: 'Sheet1',
      },
      initialLoading: false,
    })
  );

  // Save button exists but has aria-disabled="true"
  assert.ok(html.includes('Save'));
  assert.ok(html.includes('aria-disabled="true"'));
});

test('Slice 3.7: Save button is enabled (canSave: true) when spreadsheetId is present', () => {
  const { GoogleSheetsMetaData } = loadGoogleSheetsMetaData();

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(GoogleSheetsMetaData, {
      selectedType: 'Google Sheets - New or Updated Row',
      handleClick: () => {},
      initialServers: [{ id: 'server-1', email: 'user@gmail.com' }],
      initialData: {
        spreadsheetId: 'sheet-xyz-999',
        sheetName: 'Sheet1',
      },
      initialLoading: false,
    })
  );

  assert.ok(html.includes('Save'));
  assert.ok(html.includes('aria-disabled="false"'));
});
