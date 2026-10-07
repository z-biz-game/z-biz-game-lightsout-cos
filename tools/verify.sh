#!/usr/bin/env bash
# One-shot verification: the node suites first, then a real browser against a real
# server, driven over CDP. Everything exits with the script, including the Chrome it
# started in a temp profile.
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterization saturates the cores and, with no CDP client attached, the process will not
# exit on its own. This game is 2D canvas, so plain headless Chrome is enough.
#
#   ./tools/verify.sh                        # node suites + @boot @play @routes @save @pointer
#   SCENARIOS="pointer" ./tools/verify.sh    # one browser suite while editing the view
#   SKIP_UNIT=1 bash tools/verify.sh         # browser only (what the CI browser job does)
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
CDP_PORT=${CDP_PORT:-9341}; if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo ":$CDP_PORT is already LISTENING — a sibling gate or an orphan Chrome holds it; attaching there reads someone else's browser. Wait for it to finish, or rerun with CDP_PORT=<a free port>." >&2; lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >&2 || true; exit 6; fi  # 一机一台：撞在同一个默认口上时不报错的是 Chrome，报错的是绿——先让路再开闸
WEB_PORT=${WEB_PORT:-5190}
BASE=${BASE_URL:-http://127.0.0.1:$WEB_PORT/}
# 逻辑闸的读数写在仓内的 _tmp-verify/（.gitignore 里），不写 /tmp：/tmp 会被系统在半途清理，
# 而这一段的日志是「本轮 doctest 打了多少项」的唯一现场——清掉了就只能重跑一遍才知道。
TMPD="$HERE/_tmp-verify"
rm -rf "$TMPD"; mkdir -p "$TMPD"
LLOG="$TMPD/logic.log"
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }

# This machine runs one headless Chrome at a time while other repos are being verified too.
# Both endpoints are checked before anything is started, because a port already in use does
# not fail loudly here: the second Chrome silently joins the first one's DevTools.
if curl -fsS -m 1 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1; then
  echo "devtools already bound on :$CDP_PORT — another headless Chrome is running. Pick CDP_PORT." >&2; exit 5;
fi
if curl -fsS -m 1 "$BASE" >/dev/null 2>&1; then
  echo "something already answers on $BASE — pick WEB_PORT." >&2; exit 5;
fi

UDD=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$CDP_PORT --user-data-dir=$UDD \
  --window-size=900,780 --no-first-run --no-default-browser-check about:blank >"$TMPD/chrome.log" 2>&1 &
CPID=$!
node "$HERE/server.cjs" $WEB_PORT >"$TMPD/server.log" 2>&1 &
SPID=$!
cleanup() {
  kill -9 $CPID $SPID 2>/dev/null
  wait $CPID 2>/dev/null
  wait $SPID 2>/dev/null
  rm -rf $UDD
}
trap cleanup EXIT
# Watchdog redirects its fds: a background subshell inherits the script's stdout, and if
# this runs inside a pipeline it would hold the write end open for the full timeout and
# stall the consumer long after the tests finished.
( sleep ${WD_TIMEOUT:-300}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# A fresh --user-data-dir binds DevTools noticeably later than a warm profile, so wait on
# the endpoints rather than guessing a sleep duration.
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$CDP_PORT" >&2; exit 3; }
for i in $(seq 1 40); do
  curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS -m 2 "$BASE" >/dev/null 2>&1 || {
  echo "static server never answered on $BASE" >&2; exit 4; }

cd "$HERE"
FAILED=0

echo "=== node suites ==="
# SKIP_UNIT=1 for the browser job in CI: the suites are its own job there.
if [ -z "${SKIP_UNIT:-}" ]; then
  for f in test/*.test.mjs; do
    echo "--- $f"
    node "$f" || FAILED=1
  done
  # 部署集闸：ci.yml 跑这两步、本地整闸以前一次都不跑。缺这一步就是「本地全绿、线上 404 自己的
  # manifest / sw.js / 图标」这一整类坏法。它不碰 Chrome，也不读页面，纯查产物。
  echo "=== deploy-set ==="
  node tools/deploy-set.mjs || FAILED=1
  node tools/deploy-set-selftest.mjs || FAILED=1
  # The claim the whole repo rests on, quoted back from the sweep that just ran: all 65536 4x4
  # boards, coset minimum against the press graph.
  echo "=== 4x4 full-sweep evidence ==="
  node test/gf2-vs-bfs.test.mjs 2>&1 | grep -E 'sweep:' || { echo "no sweep line printed" >&2; FAILED=1; }

  # ---- 第六道闸与它的台账：CI 的 unit job 各跑一步，这道本地 one-shot 以前一步都不跑 ----
  # 于是「bash tools/verify.sh 全绿」并不等于 CI 会绿——改闸的人在家里看不见它在 CI 里红的那一条。
  # 门要两边同一把。钉的是每道闸自己的条数：rc=0 看不出闸变窄——明天有人删掉 20 条断言，
  # 剩下的照样绿、整道闸照样 exit 0。这两颗钉由 tools/doctest.mjs 的 D13 那一组反向核对
  # （它读的就是下面这一行），改一处不改另一处就是红。
  LOGIC_EXPECTS="doctest:71 sabotage:32"
  pin_of() { printf '%s\n' "$LOGIC_EXPECTS" | tr ' ' '\n' | grep "^$1:" | cut -d: -f2; }

  echo "=== 逻辑闸 tools/doctest.mjs ==="
  node "$HERE/tools/doctest.mjs" >"$LLOG" 2>&1
  DS_RC=$?
  DS=$(sed -n 's/^rows: \([0-9]*\) fail: \([0-9]*\)$/\1\/\2/p' "$LLOG" | tail -1)
  grep -E '^  未过：' "$LLOG" | head -25
  if [ "$DS" != "$(pin_of doctest)/0" ]; then
    echo "逻辑闸 doctest 体量 ${DS:-没打印 rows: 这一行} != 钉的 $(pin_of doctest)/0（rc=${DS_RC}）—— 增删一条断言要同时改 LOGIC_EXPECTS 与 D13b" >&2
    FAILED=1
  else
    echo "逻辑闸 doctest：$(pin_of doctest) 项、0 项失败 ✓"
  fi

  # 台账每一把只跑它自己点名的那条闸（node 层），不叫 verify.sh，所以这一层没有递归要挡。
  echo "=== 逻辑闸 tools/sabotage.py ==="
  python3 "$HERE/tools/sabotage.py" >"$LLOG" 2>&1
  SB_RC=$?
  SB=$(sed -n 's/^rows: \([0-9]*\) fail: \([0-9]*\)$/\1\/\2/p' "$LLOG" | tail -1)
  grep -E '^  (没红|!!|判定|===)' "$LLOG" | head -12
  if [ "$SB" != "$(pin_of sabotage)/0" ]; then
    echo "台账体量 ${SB:-没打印 rows: 这一行} != 钉的 $(pin_of sabotage)/0（rc=${SB_RC}）—— 刀少了，或某一刀没能把点名的断言逼红" >&2
    FAILED=1
  else
    echo "台账：$(pin_of sabotage) 把刀各自逼红了点名的断言 ✓"
  fi
  rm -f "$LLOG"
fi

export CDP_PORT
export BASE_URL=$BASE
node tools/playtest.mjs open "$BASE" | head -3
# The pool is a few kB of measurement and the shell resolves a route before it reports a
# state, so wait on window.lights rather than on a timer.
BOOT=""
for i in $(seq 1 60); do
  BOOT=$(node tools/playtest.mjs eval "window.lights&&window.lights.state.lot?window.lights.state.lot.id:'nope'" nonav 2>/dev/null | tr -d '\n" ')
  case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
done
echo "boot lot: $BOOT"
[ "$BOOT" = "nope" ] && { echo "window.lights never appeared at $BASE" >&2; exit 5; }

for s in ${SCENARIOS:-boot play routes save pointer}; do
  echo "=== @$s ==="
  node tools/playtest.mjs eval "@$s" nonav 2>&1 | python3 -c '
import sys, json
raw = sys.stdin.read()
start = raw.find("{")
if start < 0:
    print("NO RESULT", raw[-300:]); sys.exit(1)
depth = 0
for i in range(start, len(raw)):
    if raw[i] == "{": depth += 1
    elif raw[i] == "}":
        depth -= 1
        if depth == 0:
            try: d = json.loads(raw[start:i + 1])
            except Exception as e:
                print("BAD JSON", e, raw[start:start+200]); sys.exit(1)
            break
rows = d.get("rows", [])
print("rows:", len(rows), "fail:", d.get("fail"))
for r in rows:
    if not r["pass"]: print("  FAIL", r["test"], json.dumps(r["detail"], ensure_ascii=False)[:240])
sys.exit(1 if d.get("fail") else 0)
' || FAILED=1
  node tools/playtest.mjs shot "$TMPD/shot-$s.png" >/dev/null 2>&1
done

echo "=== console ==="
node tools/playtest.mjs logs
kill $WD 2>/dev/null
wait $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
