'use client';
import { useEffect, useState } from 'react';
import { AiActionMetaDataSchema, type AiActionMetaData } from '@repo/types';
import { aiRequest, type AiConnectionView, type AiDiscovery, type AiPreview } from '@/lib/ai';
import type { MetaDataFormProps } from '../modal/types';

type Field = NonNullable<AiActionMetaData['outputFields']>[number];
const newField = (): Field => ({ name: '', type: 'text', isRequired: true });
const providerNames: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic / Claude',
  puter: 'Puter (experimental)',
  openai_compatible: 'OpenAI-compatible (your key)',
};
const profiles = {
  chat_json_schema: 'Strict JSON Schema',
  chat_json_object: 'JSON object',
  chat_prompt_json: 'Prompted JSON (validated locally)',
};
const emptyConnection = {
  name: '',
  baseUrl: '',
  apiKey: '',
  capabilityProfileId: 'chat_json_schema',
};

export default function AiMetaData({
  handleClick,
  initialData,
}: MetaDataFormProps & { initialData?: unknown }) {
  const [initial] = useState(() => {
    const parsed = AiActionMetaDataSchema.safeParse(initialData);
    return parsed.success ? parsed.data : undefined;
  });
  const [discovery, setDiscovery] = useState<AiDiscovery>();
  const [connections, setConnections] = useState<AiConnectionView[]>([]);
  const [provider, setProvider] = useState<string>(initial?.provider || 'openai');
  const [model, setModel] = useState(initial?.model || '');
  const [connectionId, setConnectionId] = useState(initial?.connectionId || '');
  const [mode, setMode] = useState<AiActionMetaData['mode']>(initial?.mode || 'summarize');
  const [input, setInput] = useState(initial?.input || '{text}');
  const [instructions, setInstructions] = useState(initial?.instructions || '');
  const [categories, setCategories] = useState(
    initial?.categories?.join('\n') || 'positive\nneutral\nnegative'
  );
  const [fields, setFields] = useState<Field[]>(
    initial?.outputFields?.length ? initial.outputFields : [newField()]
  );
  const [structuredCustom, setStructuredCustom] = useState(
    initial?.mode === 'custom' && Boolean(initial.outputFields?.length)
  );
  const [temperature, setTemperature] = useState(initial?.temperature || 0);
  const [tokens, setTokens] = useState(initial?.maxOutputTokens || 500);
  const [sample, setSample] = useState('Order 84120 for ₹1,499 has not arrived. Please help.');
  const [preview, setPreview] = useState<AiPreview>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null | undefined>(); // undefined closed; null new
  const [connection, setConnection] = useState(emptyConnection);

  useEffect(() => {
    let alive = true;
    aiRequest<AiDiscovery>('/api/actions/ai/models')
      .then(async (data) => {
        if (!alive) return;
        setDiscovery(data);
        if (!initial) setProvider(data.defaultProvider);
        const active = data.providers.find((p) => p.id === data.defaultProvider);
        if (!initial) {
          setModel(active?.defaultModel || active?.models[0] || '');
          setTokens(Math.min(500, data.limits.maxOutputTokens));
        }
        if (data.providers.find((p) => p.id === 'openai_compatible')?.configured) {
          const saved = await aiRequest<{ connections: AiConnectionView[] }>('/api/ai/connections');
          if (alive) {
            setConnections(saved.connections);
            if (!initial?.connectionId)
              setConnectionId(saved.connections.find((c) => !c.revoked)?.id || '');
          }
        }
      })
      .catch(() => {
        if (alive) setError('Could not load AI settings. Sign in and check server configuration.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [initial]);

  const selected = discovery?.providers.find((p) => p.id === provider);
  const compatible = provider === 'openai_compatible';
  const selectedConnection = connections.find((c) => c.id === connectionId && !c.revoked);
  const canSave = Boolean(selected?.configured && (!compatible || selectedConnection));
  const build = () => {
    const parsed = AiActionMetaDataSchema.safeParse({
      provider,
      model,
      ...(compatible ? { connectionId } : {}),
      mode,
      input,
      instructions,
      ...(mode === 'classify'
        ? {
            categories: categories
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : {}),
      ...(mode === 'extract' || (mode === 'custom' && structuredCustom)
        ? { outputFields: fields }
        : {}),
      temperature,
      maxOutputTokens: tokens,
    });
    if (!parsed.success)
      throw new Error(parsed.error.issues[0]?.message || 'Check AI configuration');
    return parsed.data;
  };
  const changeField = (index: number, patch: Partial<Field>) =>
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field))
    );
  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI operation failed');
    } finally {
      setBusy(false);
    }
  };
  const closeConnection = () => {
    setEditing(undefined);
    setConnection({ ...emptyConnection });
  };
  const editConnection = (saved?: AiConnectionView) => {
    setEditing(saved?.id ?? null);
    setConnection({
      name: saved?.name || '',
      baseUrl: saved?.baseUrl || '',
      apiKey: '',
      capabilityProfileId: saved?.capabilityProfileId || 'chat_json_schema',
    });
  };
  const saveConnection = async () => {
    try {
      const payload = {
        ...connection,
        ...(editing && !connection.apiKey ? { apiKey: undefined } : {}),
      };
      const result = await aiRequest<{ connection: AiConnectionView }>(
        editing ? `/api/ai/connections/${editing}` : '/api/ai/connections',
        { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
      );
      setConnections((current) => [
        ...current.filter((c) => c.id !== result.connection.id),
        result.connection,
      ]);
      setConnectionId(result.connection.id);
      closeConnection();
      setNotice('Connection saved. Test it with a supported model before use.');
    } finally {
      setConnection((current) => ({ ...current, apiKey: '' }));
    }
  };

  return (
    <div className="ai-form">
      <div className="ai-form-heading">
        <span aria-hidden="true">✦</span>
        <div>
          <h4>AI Transform</h4>
          <p>Turn incoming text into useful workflow data.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="ai-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ai-notice">
          {notice}
        </p>
      )}
      {loading && <p role="status">Loading configured providers…</p>}
      <fieldset disabled={busy || loading}>
        <label htmlFor="ai-provider">Provider</label>
        <select
          id="ai-provider"
          value={provider}
          onChange={(event) => {
            const id = event.target.value;
            setProvider(id);
            const active = discovery?.providers.find((p) => p.id === id);
            setModel(active?.defaultModel || active?.models[0] || '');
            setPreview(undefined);
          }}
        >
          {discovery?.providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.configured}>
              {providerNames[p.id]}
              {!p.configured ? ' — not configured' : ''}
            </option>
          ))}
        </select>
        {!selected?.configured && !loading && (
          <p className="ai-help">
            This provider is not configured. Ask the operator to configure credentials, approved
            models and any required verification gates.
          </p>
        )}
        {compatible && (
          <section className="ai-connection-section" aria-label="AI connections">
            <label htmlFor="ai-connection">Saved connection</label>
            <select
              id="ai-connection"
              value={connectionId}
              onChange={(event) => setConnectionId(event.target.value)}
            >
              <option value="">Select a connection</option>
              {connections.map((saved) => (
                <option key={saved.id} value={saved.id} disabled={saved.revoked}>
                  {saved.name}
                  {saved.revoked ? ' (revoked)' : ''}
                </option>
              ))}
            </select>
            {selectedConnection && (
              <p className="ai-help">
                {selectedConnection.baseUrl} ·{' '}
                {profiles[selectedConnection.capabilityProfileId as keyof typeof profiles]}
              </p>
            )}
            <div className="ai-buttons">
              <button
                type="button"
                disabled={!selected?.configured}
                onClick={() => editConnection()}
              >
                + New connection
              </button>
              {selectedConnection && (
                <>
                  <button type="button" onClick={() => editConnection(selectedConnection)}>
                    Edit / replace key
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      act(async () => {
                        if (
                          !window.confirm(
                            'Revoke this connection? Workflows using it will fail until reconfigured.'
                          )
                        )
                          return;
                        const result = await aiRequest<{ affectedZapCount: number }>(
                          `/api/ai/connections/${connectionId}`,
                          { method: 'DELETE' }
                        );
                        setConnections((current) =>
                          current.map((c) => (c.id === connectionId ? { ...c, revoked: true } : c))
                        );
                        setConnectionId('');
                        setNotice(
                          `Connection revoked. ${result.affectedZapCount} workflow(s) affected.`
                        );
                      })
                    }
                  >
                    Revoke
                  </button>
                  <button
                    type="button"
                    disabled={!model}
                    onClick={() =>
                      act(async () => {
                        await aiRequest(`/api/ai/connections/${connectionId}/test`, {
                          method: 'POST',
                          body: JSON.stringify({ model }),
                        });
                        setNotice(
                          'Connection test passed. This call counts toward your daily budget.'
                        );
                      })
                    }
                  >
                    Test connection (billable)
                  </button>
                </>
              )}
            </div>
            {editing !== undefined && (
              <div className="ai-connection-editor">
                <h5>{editing ? 'Edit connection' : 'Connect an AI service'}</h5>
                <label htmlFor="ai-connection-name">Connection name</label>
                <input
                  id="ai-connection-name"
                  value={connection.name}
                  maxLength={100}
                  onChange={(e) => setConnection({ ...connection, name: e.target.value })}
                />
                <label htmlFor="ai-base-url">Base URL (HTTPS, approved public endpoint)</label>
                <input
                  id="ai-base-url"
                  type="url"
                  value={connection.baseUrl}
                  placeholder="https://provider.example/v1"
                  maxLength={2048}
                  onChange={(e) => setConnection({ ...connection, baseUrl: e.target.value })}
                />
                <label htmlFor="ai-api-key">
                  API key {editing ? '(leave empty to keep current)' : ''}
                </label>
                <input
                  id="ai-api-key"
                  type="password"
                  autoComplete="new-password"
                  value={connection.apiKey}
                  maxLength={8192}
                  onChange={(e) => setConnection({ ...connection, apiKey: e.target.value })}
                />
                <label htmlFor="ai-profile">Tested provider capability</label>
                <select
                  id="ai-profile"
                  value={connection.capabilityProfileId}
                  onChange={(e) =>
                    setConnection({ ...connection, capabilityProfileId: e.target.value })
                  }
                >
                  {Object.entries(profiles).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <p className="ai-help">
                  Only choose capabilities supported by this endpoint and model. Saving does not
                  make a provider call. Keys are encrypted server-side and never returned.
                </p>
                <div className="ai-buttons">
                  <button type="button" onClick={() => act(saveConnection)}>
                    Save connection
                  </button>
                  <button type="button" onClick={closeConnection}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        <label htmlFor="ai-model">Model</label>
        {compatible ? (
          <input
            id="ai-model"
            value={model}
            maxLength={200}
            placeholder="Exact model ID from your provider"
            onChange={(e) => setModel(e.target.value)}
          />
        ) : (
          <select id="ai-model" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="" disabled={!selected?.defaultModel}>
              Provider default{!selected?.defaultModel ? ' (not set)' : ''}
            </option>
            {selected?.models.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )}
        <label htmlFor="ai-mode">Transformation</label>
        <select
          id="ai-mode"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as AiActionMetaData['mode']);
            setPreview(undefined);
          }}
        >
          <option value="summarize">Summarize</option>
          <option value="classify">Classify / sentiment</option>
          <option value="extract">Extract structured fields</option>
          <option value="custom">Custom instructions</option>
        </select>
        <label htmlFor="ai-instructions">
          Instructions {mode === 'custom' ? '(required)' : '(optional)'} — never template-resolved
        </label>
        <textarea
          id="ai-instructions"
          rows={3}
          maxLength={4000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <label htmlFor="ai-input">Input template</label>
        <textarea
          id="ai-input"
          rows={3}
          maxLength={4000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <p className="ai-help">
          Map scalar fields, for example <code>{'{text}'}</code>,{' '}
          <code>{'{subject}\n{snippet}'}</code>, or <code>{'{previousOutput.output}'}</code>.
          Unknown placeholders stay literal.
        </p>
        {mode === 'classify' && (
          <>
            <label htmlFor="ai-categories">Categories (2–20 unique values, one per line)</label>
            <textarea
              id="ai-categories"
              rows={4}
              maxLength={1220}
              value={categories}
              onChange={(e) => setCategories(e.target.value)}
            />
          </>
        )}
        {mode === 'custom' && (
          <label className="ai-checkbox">
            <input
              type="checkbox"
              checked={structuredCustom}
              onChange={(e) => setStructuredCustom(e.target.checked)}
            />
            Return structured fields
          </label>
        )}
        {(mode === 'extract' || (mode === 'custom' && structuredCustom)) && (
          <section aria-label="Output fields">
            <h5>Output fields</h5>
            {fields.map((field, index) => (
              <div className="ai-field-row" key={index}>
                <label htmlFor={`ai-field-${index}`}>Field {index + 1} name</label>
                <input
                  id={`ai-field-${index}`}
                  value={field.name}
                  maxLength={50}
                  placeholder="orderId"
                  onChange={(e) => changeField(index, { name: e.target.value })}
                />
                <label htmlFor={`ai-type-${index}`}>Type</label>
                <select
                  id={`ai-type-${index}`}
                  value={field.type}
                  onChange={(e) =>
                    changeField(index, {
                      type: e.target.value as Field['type'],
                      options: e.target.value.startsWith('category_')
                        ? ['option1', 'option2']
                        : undefined,
                    })
                  }
                >
                  {['text', 'number', 'boolean', 'category_single', 'category_multi'].map(
                    (type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    )
                  )}
                </select>
                <label htmlFor={`ai-description-${index}`}>Description</label>
                <input
                  id={`ai-description-${index}`}
                  maxLength={200}
                  value={field.description || ''}
                  onChange={(e) => changeField(index, { description: e.target.value })}
                />
                <label className="ai-checkbox">
                  <input
                    type="checkbox"
                    checked={field.isRequired}
                    onChange={(e) => changeField(index, { isRequired: e.target.checked })}
                  />
                  Required
                </label>
                {field.type.startsWith('category_') && (
                  <>
                    <label htmlFor={`ai-options-${index}`}>Options (one per line)</label>
                    <textarea
                      id={`ai-options-${index}`}
                      value={field.options?.join('\n') || ''}
                      onChange={(e) => changeField(index, { options: e.target.value.split('\n') })}
                    />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
                >
                  Remove field {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={fields.length >= 25}
              onClick={() => setFields((current) => [...current, newField()])}
            >
              + Add field
            </button>
          </section>
        )}
        <details>
          <summary>Advanced limits</summary>
          <label htmlFor="ai-temperature">Temperature (0–1)</label>
          <input
            id="ai-temperature"
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
          <label htmlFor="ai-tokens">Maximum output tokens</label>
          <input
            id="ai-tokens"
            type="number"
            min={16}
            max={discovery?.limits.maxOutputTokens || 2000}
            value={tokens}
            onChange={(e) => setTokens(Number(e.target.value))}
          />
        </details>
        <section className="ai-test-panel" aria-label="Test AI step">
          <h5>Test with sample input</h5>
          <p className="ai-help">
            Literal text only, no template resolution. Tests may be billed and count toward the
            daily budget. No workflow run is created.
          </p>
          <label htmlFor="ai-sample">Sample text</label>
          <textarea
            id="ai-sample"
            rows={4}
            maxLength={discovery?.limits.maxInputChars || 20000}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          />
          <button
            type="button"
            disabled={!canSave || !sample.trim()}
            onClick={() =>
              act(async () => {
                const config = build();
                setPreview(undefined);
                setPreview(
                  await aiRequest<AiPreview>('/api/actions/ai/test', {
                    method: 'POST',
                    body: JSON.stringify({ ...config, input: sample }),
                  })
                );
              })
            }
          >
            {busy ? 'Working…' : 'Test step (billable)'}
          </button>
          {preview && (
            <div className="ai-preview" role="status">
              <h5>Parsed result</h5>
              <dl>
                {Object.entries(preview.fields).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                  </div>
                ))}
              </dl>
              <pre>{preview.output}</pre>
              <p>
                {preview.provider} / {preview.model} · {preview.latencyMs} ms
                {preview.truncated ? ' · Input truncated' : ''}
              </p>
              <p>
                Tokens: input {preview.usage?.inputTokens ?? 'not reported'}, output{' '}
                {preview.usage?.outputTokens ?? 'not reported'}
              </p>
            </div>
          )}
        </section>
        <p className="ai-disclosure">
          Text mapped into Input is sent to the selected AI service and, for Puter, may reach an
          underlying model provider. Do not map secrets or regulated data without approval. Usage
          may be billed to the configured account.
        </p>
        <p className="ai-help">
          Next step: <code>{'{previousOutput.output}'}</code> or{' '}
          <code>{'{previousOutput.fields.orderId}'}</code>. Later:{' '}
          <code>{'{stepOutputs.2.fields.orderId}'}</code>. Use scalar fields or serialized output,
          not a whole fields object. Never wire AI output directly to money transfers without
          deterministic validation.
        </p>
        <button
          type="button"
          className="ai-save"
          disabled={!canSave || editing !== undefined}
          onClick={() => {
            try {
              setError('');
              handleClick(build());
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Check AI configuration');
            }
          }}
        >
          Save AI step
        </button>
      </fieldset>
    </div>
  );
}
