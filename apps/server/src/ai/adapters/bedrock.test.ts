/**
 * Bedrock model handling.
 *
 * The adapter uses InvokeModel with a per-family codec (not the Converse API), so
 * EVERY family Bedrock offers is usable — Anthropic, DeepSeek, Llama, Nova,
 * Titan, Mistral, Cohere. These tests pin the wire format each family expects,
 * since getting one wrong surfaces only as an opaque AWS ValidationException.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codecFor,
  findCodec,
  isInvokable,
  isTextGenerationModel,
  modelVendor,
  type FoundationModelLike,
} from './bedrock.js';

const req = {
  model: 'x',
  system: 'You are terse.',
  messages: [
    { role: 'user' as const, content: 'Hello' },
    { role: 'assistant' as const, content: 'Hi' },
    { role: 'user' as const, content: 'More' },
  ],
  temperature: 0.7,
  maxTokens: 512,
};

test('vendor is read from bare and region-prefixed ids', () => {
  assert.equal(modelVendor('anthropic.claude-3-5-sonnet-20241022-v2:0'), 'anthropic');
  assert.equal(modelVendor('us.anthropic.claude-opus-4-6-v1'), 'anthropic');
  assert.equal(modelVendor('eu.deepseek.r1-v1:0'), 'deepseek');
  assert.equal(modelVendor('apac.meta.llama3-3-70b-instruct-v1:0'), 'meta');
  assert.equal(modelVendor('mistral.mistral-large-2407-v1:0'), 'mistral');
});

test('every supported family produces a body and parses its own response', () => {
  const cases: { id: string; body: (b: Record<string, unknown>) => void; res: Record<string, unknown>; want: string }[] = [
    {
      id: 'us.anthropic.claude-opus-4-6-v1',
      body: (b) => {
        assert.equal(b.anthropic_version, 'bedrock-2023-05-31');
        assert.equal(b.system, 'You are terse.');
        assert.equal((b.messages as unknown[]).length, 3);
      },
      res: { content: [{ type: 'text', text: 'ok' }] },
      want: 'ok',
    },
    {
      id: 'us.deepseek.r1-v1:0',
      body: (b) => {
        // Text-completion api: ONE prompt string, no `messages` array.
        assert.equal(b.messages, undefined);
        const p = String(b.prompt);
        assert.ok(p.includes('<｜begin▁of▁sentence｜>'), 'has the R1 preamble token');
        assert.ok(p.includes('<｜User｜>Hello'), 'user turns are tagged');
        assert.ok(p.endsWith('<｜Assistant｜><think>\n'), 'ends ready for the answer');
        assert.ok(p.includes('You are terse.'), 'system text is carried');
      },
      // The real documented response shape — choices[].text, NOT message.content.
      res: { choices: [{ text: 'ok', stop_reason: 'stop' }] },
      want: 'ok',
    },
    {
      id: 'us.meta.llama3-3-70b-instruct-v1:0',
      body: (b) => {
        assert.ok(String(b.prompt).includes('You are terse.'));
        assert.equal(b.max_gen_len, 512);
      },
      res: { generation: 'ok' },
      want: 'ok',
    },
    {
      id: 'us.amazon.nova-pro-v1:0',
      body: (b) => {
        assert.equal(b.schemaVersion, 'messages-v1');
        assert.deepEqual(b.system, [{ text: 'You are terse.' }]);
      },
      res: { output: { message: { content: [{ text: 'ok' }] } } },
      want: 'ok',
    },
    {
      id: 'amazon.titan-text-express-v1',
      body: (b) => {
        assert.ok(String(b.inputText).includes('You are terse.'));
        assert.ok(b.textGenerationConfig);
      },
      res: { results: [{ outputText: 'ok' }] },
      want: 'ok',
    },
    {
      id: 'mistral.mistral-large-2407-v1:0',
      body: (b) => assert.ok(String(b.prompt).startsWith('<s>[INST]')),
      res: { outputs: [{ text: 'ok' }] },
      want: 'ok',
    },
    {
      id: 'cohere.command-r-plus-v1:0',
      body: (b) => {
        // last turn is `message`, the rest become chat_history
        assert.equal(b.message, 'More');
        assert.equal((b.chat_history as unknown[]).length, 2);
        assert.equal(b.preamble, 'You are terse.');
      },
      res: { text: 'ok' },
      want: 'ok',
    },
  ];

  for (const c of cases) {
    const codec = codecFor(c.id);
    c.body(codec.body({ ...req, model: c.id }));
    assert.equal(codec.text(c.res), c.want, `${c.id} response parse`);
  }
});

test('titan and nova are told apart despite sharing the amazon vendor', () => {
  const titan = codecFor('amazon.titan-text-express-v1').body(req);
  const nova = codecFor('us.amazon.nova-pro-v1:0').body(req);
  assert.ok(titan.inputText, 'titan uses inputText');
  assert.equal(nova.schemaVersion, 'messages-v1', 'nova uses the messages envelope');
});

test('stream deltas are extracted per family', () => {
  assert.equal(
    codecFor('us.anthropic.claude-opus-4-6-v1').delta({
      type: 'content_block_delta',
      delta: { text: 'a' },
    }),
    'a',
  );
  assert.equal(codecFor('us.meta.llama3-3-70b-instruct-v1:0').delta({ generation: 'b' }), 'b');
  assert.equal(codecFor('us.deepseek.r1-v1:0').delta({ choices: [{ text: 'c' }] }), 'c');
  assert.equal(
    codecFor('us.amazon.nova-pro-v1:0').delta({ contentBlockDelta: { delta: { text: 'd' } } }),
    'd',
  );
  assert.equal(
    codecFor('cohere.command-r-plus-v1:0').delta({ event_type: 'text-generation', text: 'e' }),
    'e',
  );
});

test('an unknown family fails with a message naming what IS supported', () => {
  assert.throws(
    () => codecFor('somevendor.some-model-v1:0'),
    (e: Error) => /somevendor/.test(e.message) && /anthropic/.test(e.message),
  );
});

test('empty system is omitted rather than sent blank', () => {
  const bare = { ...req, system: '   ' };
  assert.equal(codecFor('us.anthropic.claude-opus-4-6-v1').body(bare).system, undefined);
  assert.equal(codecFor('us.amazon.nova-pro-v1:0').body(bare).system, undefined);
  const dsPrompt = String(codecFor('us.deepseek.r1-v1:0').body(bare).prompt);
  assert.ok(dsPrompt.startsWith('<｜begin▁of▁sentence｜><｜User｜>'), 'no blank preamble');
});

// ── DeepSeek regressions: wrong shape produced a blank reply ──

test('deepseek reads choices[].text — the documented field, not message.content', () => {
  const codec = codecFor('us.deepseek.r1-v1:0');
  // The old codec looked for choices[].message.content first and returned ''.
  assert.equal(codec.text({ choices: [{ text: 'the reply' }] }), 'the reply');
});

test('deepseek reasoning scratchpad is stripped from the answer', () => {
  const codec = codecFor('us.deepseek.r1-v1:0');
  // The prompt opens <think>, so completions typically carry only the closer.
  assert.equal(codec.text({ choices: [{ text: 'weighing it up</think>\n\nThe reply.' }] }), 'The reply.');
  // A fully-formed pair is handled too.
  assert.equal(codec.text({ choices: [{ text: '<think>hmm</think>Answer.' }] }), 'Answer.');
});

test('deepseek stop_reason is read', () => {
  assert.equal(
    codecFor('us.deepseek.r1-v1:0').stop!({ choices: [{ stop_reason: 'length' }] }),
    'length',
  );
});

test('streamed reasoning is suppressed until the scratchpad closes', () => {
  const filter = codecFor('us.deepseek.r1-v1:0').streamFilter!();
  assert.equal(filter('let me think'), '', 'reasoning is swallowed');
  assert.equal(filter(' some more'), '', 'still swallowed');
  assert.equal(filter('</think>\n\nOnce'), 'Once', 'emits only after the close tag');
  assert.equal(filter(' upon a time'), ' upon a time', 'passes through thereafter');
});

test('max_tokens is capped at 8192 where quality degrades', () => {
  const b = codecFor('us.deepseek.r1-v1:0').body({ ...req, model: 'us.deepseek.r1-v1:0', maxTokens: 32000 });
  assert.equal(b.max_tokens, 8192);
});

// ── availability filtering (independent of family) ──

const model = (over: Partial<FoundationModelLike> = {}): FoundationModelLike => ({
  modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  outputModalities: ['TEXT'],
  inferenceTypesSupported: ['ON_DEMAND'],
  modelLifecycle: { status: 'ACTIVE' },
  ...over,
});

test('non-Anthropic families are NOT filtered out of the picker', () => {
  for (const id of [
    'us.deepseek.r1-v1:0',
    'us.meta.llama3-3-70b-instruct-v1:0',
    'us.amazon.nova-pro-v1:0',
    'mistral.mistral-large-2407-v1:0',
    'cohere.command-r-plus-v1:0',
  ]) {
    assert.equal(isInvokable(model({ modelId: id })), true, `${id} must be offered`);
  }
});

test('LEGACY models are filtered out', () => {
  assert.equal(isInvokable(model({ modelLifecycle: { status: 'LEGACY' } })), false);
});

test('models without ON_DEMAND need provisioned throughput — filtered out', () => {
  assert.equal(isInvokable(model({ inferenceTypesSupported: ['PROVISIONED'] })), false);
});

test('non-text output models are filtered out', () => {
  assert.equal(isInvokable(model({ outputModalities: ['IMAGE'] })), false);
});

test('absent optional metadata is not treated as disqualifying', () => {
  assert.equal(isInvokable({ modelId: 'us.deepseek.r1-v1:0' }), true);
});

// ── non-LLMs (embeddings, rerank, image, video, speech) ──

test('non-LLM models are excluded by id', () => {
  for (const id of [
    'amazon.titan-embed-text-v2:0',
    'amazon.titan-embed-image-v1',
    'cohere.embed-english-v3',
    'cohere.embed-multilingual-v3',
    'cohere.rerank-v3-5:0',
    'amazon.rerank-v1:0',
    'amazon.titan-image-generator-v2:0',
    'amazon.nova-canvas-v1:0',
    'amazon.nova-reel-v1:1',
    'amazon.nova-sonic-v1:0',
    'stability.stable-diffusion-xl-v1',
    'stability.sd3-5-large-v1:0',
    'amazon.titan-multimodal-embed-g1',
  ]) {
    assert.equal(isTextGenerationModel(id), false, `${id} is not an LLM`);
    assert.equal(isInvokable({ modelId: id }), false, `${id} must not be offered`);
  }
});

test('real chat models are NOT caught by the non-LLM patterns', () => {
  for (const id of [
    'us.anthropic.claude-opus-4-6-v1',
    'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    'us.deepseek.r1-v1:0',
    'us.meta.llama3-3-70b-instruct-v1:0',
    'us.amazon.nova-pro-v1:0',
    'us.amazon.nova-lite-v1:0',
    'us.amazon.nova-micro-v1:0',
    'mistral.mistral-large-2407-v1:0',
    'cohere.command-r-plus-v1:0',
    'amazon.titan-text-express-v1',
  ]) {
    assert.equal(isTextGenerationModel(id), true, `${id} IS a chat model`);
  }
});

test('embedding output modality is excluded even when TEXT is also listed', () => {
  assert.equal(
    isInvokable({
      modelId: 'some.model-v1:0',
      outputModalities: ['TEXT', 'EMBEDDING'],
    }),
    false,
  );
});

test('a model that cannot accept text input is excluded', () => {
  assert.equal(
    isInvokable({
      modelId: 'some.model-v1:0',
      inputModalities: ['IMAGE'],
      outputModalities: ['TEXT'],
    }),
    false,
  );
});

test('picking a non-LLM fails with a clear message rather than a codec error', () => {
  assert.throws(
    () => codecFor('amazon.titan-embed-text-v2:0'),
    (e: Error) => /not a text-generation model/.test(e.message),
  );
});

// ── families with no request format must never be offered ──

test('families without a codec are excluded from the picker', () => {
  // These are real Bedrock text LLMs, but this app has no request format for
  // them — so offering them would only fail once the author pressed send.
  for (const id of [
    'us.writer.palmyra-x5-v1:0',
    'us.writer.palmyra-x4-v1:0',
    'writer.palmyra-x5-v1:0',
    'ai21.jamba-1-5-large-v1:0',
    'us.twelvelabs.pegasus-1-2-v1:0',
    'luma.ray-v2:0',
  ]) {
    assert.equal(findCodec(id), null, `${id} has no codec`);
    assert.equal(isInvokable({ modelId: id }), false, `${id} must not be offered`);
  }
});

test('every family WITH a codec is still offered', () => {
  for (const id of [
    'us.anthropic.claude-opus-4-6-v1',
    'us.deepseek.r1-v1:0',
    'us.meta.llama3-3-70b-instruct-v1:0',
    'us.amazon.nova-pro-v1:0',
    'amazon.titan-text-express-v1',
    'mistral.mistral-large-2407-v1:0',
    'cohere.command-r-plus-v1:0',
  ]) {
    assert.notEqual(findCodec(id), null, `${id} has a codec`);
    assert.equal(isInvokable({ modelId: id }), true, `${id} must be offered`);
  }
});

test('the picker and the invoke path agree on every id', () => {
  // The bug class this guards: a model listed in the picker that then throws at
  // generate-time. isInvokable and codecFor must never disagree.
  const ids = [
    'us.anthropic.claude-opus-4-6-v1',
    'us.deepseek.r1-v1:0',
    'us.writer.palmyra-x5-v1:0',
    'ai21.jamba-1-5-large-v1:0',
    'amazon.titan-embed-text-v2:0',
    'amazon.nova-canvas-v1:0',
    'cohere.command-r-plus-v1:0',
  ];
  for (const id of ids) {
    const offered = isInvokable({ modelId: id });
    let invokable = true;
    try {
      codecFor(id);
    } catch {
      invokable = false;
    }
    assert.equal(offered, invokable, `${id}: picker says ${offered}, invoke says ${invokable}`);
  }
});

test('an unsupported family names what IS supported, without listing titan twice', () => {
  try {
    codecFor('us.writer.palmyra-x5-v1:0');
    assert.fail('should have thrown');
  } catch (e) {
    const msg = (e as Error).message;
    assert.match(msg, /writer/, 'names the offending family');
    assert.match(msg, /anthropic/, 'lists supported families');
    assert.equal(msg.match(/titan/g)?.length, 1, 'titan appears exactly once');
  }
});
