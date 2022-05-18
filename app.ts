import {
  Application,
  Router,
  Status,
} from "https://deno.land/x/oak@v10.5.1/mod.ts";

let token: string;
function setToken () {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  let hex = '';
  for (const v of arr) {
    hex += v.toString(16).padStart(2, '0');
  }
  token = hex;
  log(`new token is ${hex}`);
};

function log<T>(msg: T) {
  console.log(`${new Date().toISOString()}: ${msg}`);
}

const app = new Application();
const hostnames: [string, number][] = [['0.0.0.0', 8080]];

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
    response.body = (await index()).replace('<data-date/>', new Date().toUTCString());
    response.type = 'text/html';
  })
  .get('/reload', ({ request, response }) => {
    if (
      request.url.searchParams.get('token') == token
    ) {
      setToken();
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

(([hostname, port]) =>
  app.listen({ hostname, port })
)(hostnames[0]);
log(
  `listenting on ${hostnames
    .map(([h, p]) => `http://${h}${p != 80 ? `:${p}` : ''}/`).join(' | ')
  }`);
setToken();