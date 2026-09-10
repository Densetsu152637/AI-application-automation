import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type FixtureRequest = { method: string; path: string; body: string };

type StartedServer = { server: Server; url: string; requests: FixtureRequest[]; close(): Promise<void> };

function startServer(handler: (request: IncomingMessage, response: ServerResponse, body: string) => void): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    const requests: FixtureRequest[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({ method: request.method ?? 'GET', path: request.url ?? '/', body });
        handler(request, response, body);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('fixture server did not bind to a TCP port'));
      resolve({ server, url: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())) });
    });
  });
}

export function createFixtureWebsite(): Promise<StartedServer & { startUrl: string }> {
  return startServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><a href="/jobs/data-engineer?utm_source=fixture">Data Engineer</a>
      <a href="/jobs/data-engineer">Data Engineer (duplicate)</a>
      <a href="/jobs/data-engineer?gclid=fixture">Data Engineer (tracking duplicate)</a>
      <a href="https://real-employer.example/jobs/secret">Real employer (must not be contacted)</a>`);
  }).then(server => ({ ...server, startUrl: `${server.url}/search` }));
}

export function createFakeModelServer(result: unknown = { decision: 'needs_review' }): Promise<StartedServer & { modelId: string }> {
  const modelId = 'fixture-model-v1';
  return startServer((_request, response, body) => {
    if (_request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: modelId, max_context_tokens: 32768, active_attention_tokens: 32768 }] }));
      return;
    }
    assertPostPath(_request.url, '/v1/chat/completions');
    const payload = JSON.parse(body) as { temperature?: number; stream?: boolean; model?: string };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'fixture-completion-1', object: 'chat.completion', model: payload.model, choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
  }).then(server => ({ ...server, modelId }));
}

function assertPostPath(path: string | undefined, expected: string): asserts path {
  if (path !== expected) throw new Error(`unexpected fixture model path: ${path ?? '<missing>'}`);
}

export function guardedFetch(allowedOrigins: readonly string[], blocked: string[]): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (!allowedOrigins.includes(url.origin)) {
      blocked.push(url.href);
      throw new Error(`fixture network guard blocked ${url.href}`);
    }
    return fetch(input, init);
  };
}
