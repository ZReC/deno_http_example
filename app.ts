import {
  Application,
  Router,
  Status,
} from "https://deno.land/x/oak@v10.5.1/mod.ts";

const token = (() => {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  let hex = '';
  for (const v of arr) {
    hex += v.toString(16).padStart(2, '0');
  }
  return hex;
})();

function log<T>(msg: T) {
  Deno.stdout.write(
    new TextEncoder().encode(`${new Date().toISOString()}: ${msg}\n`)
  );
}

const app = new Application();
const hostnames: [string, number][] = [['0.0.0.0', 8080]];

let listeners: Promise<void>[];
let controller = new AbortController();

function listen(hostnames: [string, number][], signal: AbortSignal) {
  const promises = [];
  for (const [hostname, port] of hostnames) {
    promises.push(app.listen({ hostname, port, signal }));
  }
  log(
    `listenting on ${hostnames
      .map(([h, p]) => `http://${h}${p != 80 ? `:${p}` : ''}/`).join(' | ')
    }`);
  return promises;
}

function openFile(name: string): () => Promise<string> {
  let contents: Promise<string>;
  let modified = true;

  const watcher = Deno.watchFs(name);
  (async () => {
    for await (const event of watcher) {
      // check if flag "modified" was set
      // (works as a debouncer, not really needed)
      if (!modified && event.kind == 'modify') {
        modified = true;
      }
    }
  })();

  return () => {
    if (modified) {
      modified = false;
      contents = (async () =>
        new TextDecoder().decode(await Deno.readFile(name)))();
    }

    return contents;
  };
}

const [index, post, n405] = ['index.htm', 'post.htm', 'n405.htm']
  .map((v) => openFile(v));

const router = new Router()
  .get('/', async ({ response }) => {
    response.body = (await index()).replace(
      /<script'eval>([\s\S]*?)<\/script>/,
      (_, v) => eval(v)
    );
    response.type = 'text/html';
  })
  .get('/reload', ({ request, response }) => {
    if (
      request.url.searchParams.get('token') == token &&
      !controller.signal.aborted
    ) {
      log('reloading listeners');
      controller.abort();
      Promise.all(listeners).then(() => {
        // don't await for listeners, they must first
        // finish all connections to be aborted.
        controller = new AbortController();
        listeners = listen(hostnames, controller.signal);
      });
      response.redirect('/');
    } else {
      response.status = Status.Teapot;
    }
  })
  .post('/post', async ({ request, response }) => {
    const value = await request.body({ type: 'form' }).value;
    const name = value.get('n')?.slice(0, 32);

    if (name) {
      response.type = 'text/html';

      if (/^\b([a-zA-Z] ?)+\b$/.test(name)) {
        log(`"${name}" says hi`);
        response.body = (await post()).replace('<data-name/>', name);
        return;
      } else {
        log(`invalid name "base64/${btoa(name)}"`);
        response.body = await n405();
      }
    }
    response.status = Status.BadRequest;
  });

app.use(router.routes());
app.use(router.allowedMethods());

listeners = listen(hostnames, controller.signal);
log(`session token is ${token}`);