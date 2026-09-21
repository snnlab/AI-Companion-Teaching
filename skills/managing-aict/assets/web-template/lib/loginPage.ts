// Keep the neutral form and error affordance in sync with middleware.ts's
// self-contained copy. Middleware cannot import this module in production.
export function loginPageHtml(showInvalidPassword = false): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Board — password required</title>
<style>
  body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9}
  form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 1px 8px rgba(0,0,0,.08);width:min(92vw,340px)}
  h1{font-size:1.1rem;margin:0 0 1rem} label{display:block;font-size:.85rem;color:#444;margin-bottom:.4rem}
  input{width:100%;box-sizing:border-box;font-size:1.1rem;padding:.7rem;border:1px solid #ccc;border-radius:8px}
  button{width:100%;margin-top:1rem;font-size:1rem;padding:.7rem;border:0;border-radius:8px;background:#2563eb;color:#fff}
  p.err{color:#b91c1c;font-size:.85rem;margin:.6rem 0 0}
</style></head><body>
<form method="POST" action="/api/login">
  <h1>This board is private</h1>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" autofocus>
  ${showInvalidPassword ? '<p class="err" role="alert">Incorrect password. Try again.</p>' : ""}
  <button type="submit">Open board</button>
</form></body></html>`;
}
