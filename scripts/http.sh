#!/usr/bin/env bash
# Checks the three shipping surfaces against a running server, because none of
# them can be verified from types alone: a preview card is an image a crawler
# fetches, an embed is a header a browser enforces, and an ingest route is
# whatever a stranger POSTs to it.
#
#   npx next start -p 3111 &   then   bash scripts/http.sh
set -u
BASE=${BASE:-http://localhost:3111}
fail=0

pass() { echo "  PASS  $1"; }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
ok()   { if [ "$1" = "1" ]; then pass "$2"; else bad "$2"; fi }

LINK="/a/binary-search?a=2,5,8,12,16,23,38,56,72,91&t=23&step=14"

echo
echo "=== the preview card is a real render of a real step ==="
CARD="$BASE/api/og?slug=binary-search&a=2,5,8,12,16,23,38,56,72,91&t=23&step=14"
code=$(curl -s -o /tmp/card.png -w "%{http_code}" "$CARD")
type=$(curl -s -o /dev/null -w "%{content_type}" "$CARD")
size=$(wc -c < /tmp/card.png | tr -d ' ')
echo "  $code  $type  ${size} bytes"
ok "$([ "$code" = "200" ] && echo 1 || echo 0)" "the card route answers 200"
ok "$(echo "$type" | grep -qi png && echo 1 || echo 0)" "it is a PNG"
ok "$([ "$size" -gt 12000 ] && echo 1 || echo 0)" "it has real content, not an error glyph ($size bytes)"
ok "$(head -c 8 /tmp/card.png | od -An -tx1 | grep -q '89 50 4e 47' && echo 1 || echo 0)" "with a PNG signature"

# Two different steps must not produce the same image; that is the whole point.
curl -s -o /tmp/card2.png "$BASE/api/og?slug=binary-search&a=2,5,8,12,16,23,38,56,72,91&t=23&step=3"
s1=$(md5sum /tmp/card.png | cut -d' ' -f1)
s2=$(md5sum /tmp/card2.png | cut -d' ' -f1)
ok "$([ "$s1" != "$s2" ] && echo 1 || echo 0)" "a different step renders a different card"

curl -s -o /tmp/card3.png -w "" "$BASE/api/og?slug=not-real&step=1"
ok "$([ -s /tmp/card3.png ] && echo 1 || echo 0)" "an unknown algorithm still returns an image, not a 500"

echo
echo "=== the page carries that card in its metadata ==="
HTML=$(curl -s "$BASE$LINK")
ok "$(echo "$HTML" | grep -q 'og:image' && echo 1 || echo 0)" "og:image is present"
ok "$(echo "$HTML" | grep -q 'api/og' && echo 1 || echo 0)" "and points at the rendered card"
ok "$(echo "$HTML" | grep -q 'step=14' && echo 1 || echo 0)" "carrying the step from the link"
ok "$(echo "$HTML" | grep -q 'summary_large_image' && echo 1 || echo 0)" "twitter card is the large form"
ok "$(echo "$HTML" | grep -q 'json+oembed' && echo 1 || echo 0)" "the oEmbed endpoint is discoverable"
TITLE=$(echo "$HTML" | grep -o '<title>[^<]*</title>' | head -1)
echo "  $TITLE"
ok "$(echo "$TITLE" | grep -q 'step 15' && echo 1 || echo 0)" "the title names the step, not just the algorithm"

echo
echo "=== oEmbed answers for this site and refuses everything else ==="
OE=$(curl -s "$BASE/api/oembed?url=$(printf '%s' "$BASE$LINK" | sed 's/&/%26/g;s/?/%3F/g;s|/|%2F|g;s/:/%3A/g')&format=json")
echo "  $(echo "$OE" | head -c 150)…"
ok "$(echo "$OE" | grep -q '"type":"rich"' && echo 1 || echo 0)" "returns a rich embed"
ok "$(echo "$OE" | grep -q '/embed/binary-search' && echo 1 || echo 0)" "framing the embed route"
ok "$(echo "$OE" | grep -q 'step=14' && echo 1 || echo 0)" "at the step the link named"
ok "$(echo "$OE" | grep -q 'thumbnail_url' && echo 1 || echo 0)" "with a thumbnail"

# A refusal is a refusal: an unparseable URL is 400, a parseable foreign one
# is 404. What matters is that neither is framed.
for u in "https%3A%2F%2Fevil.example%2Fa%2Fbinary-search"          "https%3A%2F%2Flocalhost.evil.com%2Fa%2Fbinary-search"          "javascript%3Aalert(1)"          "%2F%2Fevil.example%2Fa%2Fbinary-search"; do
  body=$(curl -s "$BASE/api/oembed?url=$u")
  c=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/oembed?url=$u")
  refused=$([ "$c" = "404" ] || [ "$c" = "400" ] && ! echo "$body" | grep -q '<iframe' && echo 1 || echo 0)
  ok "$refused" "refuses ${u:0:38} ($c)"
done
c=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/oembed?url=$(printf '%s' "$BASE/insights" | sed 's|/|%2F|g;s/:/%3A/g')")
ok "$([ "$c" = "404" ] && echo 1 || echo 0)" "refuses a page that is not an algorithm ($c)"

echo
echo "=== the embed may be framed, and nothing else may ==="
EH=$(curl -s -D - -o /dev/null "$BASE/embed/binary-search?a=1,2,3&t=3")
PH=$(curl -s -D - -o /dev/null "$BASE/a/binary-search")
echo "  embed: $(echo "$EH" | grep -i 'content-security-policy' | tr -d '\r')"
echo "  page:  $(echo "$PH" | grep -i 'content-security-policy' | tr -d '\r')"
ok "$(echo "$EH" | grep -qi 'frame-ancestors \*' && echo 1 || echo 0)" "the embed allows any framer"
ok "$(echo "$PH" | grep -qi "frame-ancestors 'self'" && echo 1 || echo 0)" "the workbench does not"
ok "$(echo "$PH" | grep -qi 'nosniff' && echo 1 || echo 0)" "and sends nosniff"

EMBED=$(curl -s "$BASE/embed/binary-search?a=2,5,8,12,16,23&t=16&step=4")
ok "$(echo "$EMBED" | grep -q 'open in AlgoScope' && echo 1 || echo 0)" "the embed offers a way back to the full page"
ok "$(echo "$EMBED" | grep -q 'noindex' && echo 1 || echo 0)" "and asks not to be indexed itself"

echo
echo "=== the ingest route trusts nothing ==="
post() { curl -s -o /dev/null -w "%{http_code}" -X POST -H 'content-type: application/json' -d "$2" "$BASE/api/signal"; }
GOOD='{"v":1,"session":"testsession01","slug":"binary-search","lang":"cpp","mutations":[],"input":"1,2,3|3","steps":9,"visited":[{"i":0,"line":5,"visits":2,"dwell":4}],"checkpoints":[{"line":8,"correct":false}],"divergedAtLine":null,"lastLine":5,"finished":false,"duration":22}'
ok "$([ "$(post x "$GOOD")" = "204" ] && echo 1 || echo 0)" "a well-formed signal is accepted (204, no body)"
ok "$([ "$(post x '{"v":1}')" = "400" ] && echo 1 || echo 0)" "an incomplete one is refused"
ok "$([ "$(post x 'not json')" = "400" ] && echo 1 || echo 0)" "so is anything unparseable"
PATHY='{"v":1,"session":"testsession01","slug":"../../etc/passwd","lang":"cpp","mutations":[],"input":"1","steps":9,"visited":[{"i":0,"line":5,"visits":1,"dwell":1}],"checkpoints":[],"divergedAtLine":null,"lastLine":5,"finished":false,"duration":2}'
FRACTION='{"v":1,"session":"testsession01","slug":"binary-search","lang":"cpp","mutations":[],"input":"1","steps":9,"visited":[{"i":0,"line":5,"visits":1.5,"dwell":1}],"checkpoints":[],"divergedAtLine":null,"lastLine":5,"finished":false,"duration":2}'
HUGE='{"v":1,"session":"testsession01","slug":"binary-search","lang":"cpp","mutations":[],"input":"1","steps":9,"visited":[{"i":0,"line":5,"visits":1,"dwell":999999}],"checkpoints":[],"divergedAtLine":null,"lastLine":5,"finished":false,"duration":2}'
ok "$([ "$(post x "$PATHY")" = "400" ] && echo 1 || echo 0)" "so is a slug that is a path"
ok "$([ "$(post x "$FRACTION")" = "400" ] && echo 1 || echo 0)" "so is a fractional count, rather than being rounded"
ok "$([ "$(post x "$HUGE")" = "400" ] && echo 1 || echo 0)" "so is a dwell beyond the cap"
ok "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/signal")" = "405" ] && echo 1 || echo 0)" "GET is not a way to read the log back"

echo
echo "=== the insights page reports what it actually has ==="
INS=$(curl -s "$BASE/insights")
ok "$(echo "$INS" | grep -q 'Where readers get stuck' && echo 1 || echo 0)" "the page renders"
ok "$(echo "$INS" | grep -q 'Binary Search' && echo 1 || echo 0)" "and already shows the session just posted"
ok "$(echo "$INS" | grep -qE 'not yet enough|unknown rather than estimated' && echo 1 || echo 0)" "saying plainly that one session is not enough for a rate"

echo
if [ "$fail" = "0" ]; then echo "All checks passed."; else echo "$fail check(s) failed."; fi
exit "$fail"
