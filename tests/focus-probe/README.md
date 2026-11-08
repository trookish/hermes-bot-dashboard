# Focus probe (group vs bot)

Headless check that the pane follows a group chat when one is on screen and
hands back to the bot when it is not. It drives the real `desktop/plugin.js`
against a replica of the app's DOM contract:

- a group chat view is `[data-preview-annotate-destination="group"]` with
  `data-preview-annotate-owner-key="group:id:<roomId>"` (or `group:name:<name>`);
- a room parked in an inactive tab is `visibility:hidden` (`invisible`),
  `inert`, and zero-sized.

## Run

```bash
# 1. bundle (esbuild is in the hermes-agent tree)
H=C:/Users/trookish/AppData/Local/hermes/hermes-agent
NODE_PATH="$H/apps/desktop/node_modules;$H/node_modules" $H/node_modules/.bin/esbuild \
  tests/focus-probe/probe-entry.js --bundle --format=iife --jsx=automatic \
  --alias:react=$H/node_modules/react --alias:react-dom=$H/node_modules/react-dom \
  --alias:@hermes/plugin-sdk=<scratch>/sdk-stub.js --loader:.json=json \
  --outfile=tests/focus-probe/probe.bundle.js

# 2. serve this folder, then
chrome --headless=new --virtual-time-budget=30000 --dump-dom http://127.0.0.1:8765/probe.html
```

`probe-entry.js` expects `data.json` (fixtures) and `sdk-stub.js` beside it;
copy them from the build harness. The page title ends in
`RESULT [{step, expect, got, ok}]` — every row must read `ok: true`.
