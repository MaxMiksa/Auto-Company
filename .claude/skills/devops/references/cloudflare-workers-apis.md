# Cloudflare Workers Runtime APIs

Key runtime APIs for Workers development.

## Fetch API

```typescript
// Subrequest
const response = await fetch('https://api.example.com/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'value' }),
  cf: {
    cacheTtl: 3600,
    cacheEverything: true
  }
});

const data = await response.json();
```

## Headers API

```typescript
// Read headers
const userAgent = request.headers.get('User-Agent');

// Cloudflare-specific
const country = request.cf?.country;
const colo = request.cf?.colo;
const clientIP = request.headers.get('CF-Connecting-IP');

// Set headers
const headers = new Headers();
headers.set('Content-Type', 'application/json');
headers.append('X-Custom-Header', 'value');
```

## HTMLRewriter

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const response = await fetch(request);

    return new HTMLRewriter()
      .on('title', {
        element(element) {
          element.setInnerContent('New Title');
        }
      })
      .on('a[href]', {
        element(element) {
          const href = element.getAttribute('href');
          element.setAttribute('href', href.replace('http://', 'https://'));
        }
      })
      .transform(response);
  }
};
```

## WebSockets

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    server.addEventListener('message', (event) => {
      server.send(`Echo: ${event.data}`);
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
};
```

## Streams API

```typescript
const { readable, writable } = new TransformStream();

const writer = writable.getWriter();
writer.write(new TextEncoder().encode('chunk 1'));
writer.write(new TextEncoder().encode('chunk 2'));
writer.close();

return new Response(readable, {
  headers: { 'Content-Type': 'text/plain' }
});
```

## Web Crypto API

```typescript
// Generate hash
const data = new TextEncoder().encode('message');
const hashBuffer = await crypto.subtle.digest('SHA-256', data);
const hashArray = Array.from(new Uint8Array(hashBuffer));
const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

// HMAC signature
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode('secret'),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign', 'verify']
);

const signature = await crypto.subtle.sign('HMAC', key, data);
const valid = await crypto.subtle.verify('HMAC', key, signature, data);

// Random values
const randomBytes = crypto.getRandomValues(new Uint8Array(32));
const uuid = crypto.randomUUID();
```

## Encoding APIs

```typescript
// TextEncoder
const encoder = new TextEncoder();
const bytes = encoder.encode('Hello');

// TextDecoder
const decoder = new TextDecoder();
const text = decoder.decode(bytes);

// Base64
const base64 = btoa('Hello');
const decoded = atob(base64);
```

## URL API

```typescript
const url = new URL(request.url);
const hostname = url.hostname;
const pathname = url.pathname;
const search = url.search;

// Query parameters
