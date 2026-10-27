#!/data/data/com.termux/files/usr/bin/bash
set +e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0

pass() { echo -e "${GREEN}✅ $1${NC}"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}❌ $1${NC}"; echo "   → $2"; FAIL=$((FAIL+1)); }
info() { echo -e "${YELLOW}ℹ  $1${NC}"; }

echo "========================================"
echo "  رسن — اختبار شامل"
echo "========================================"
echo "Node:    $(node --version 2>/dev/null || echo 'غير مثبت')"
echo "npm:     $(npm --version 2>/dev/null || echo 'غير مثبت')"
echo "curl:    $(curl --version 2>/dev/null | head -1 || echo 'غير مثبت')"
echo "أين:     $(pwd)"
echo "========================================"

info "فحص الملفات..."
[ -f server/server.js ] && pass "server/server.js موجود" || fail "server/server.js مفقود" "تأكد أنك في جذر المشروع"
[ -f server/db.js ]     && pass "server/db.js موجود" || fail "server/db.js مفقود" "أعد clone"
[ -f web/app.js ]       && pass "web/app.js موجود" || fail "web/app.js مفقود" "أعد clone"
[ -d server/node_modules ] && pass "node_modules مثبتة" || fail "node_modules مفقودة" "cd server && npm install"

info "فحص mobile..."
if [ -d mobile/lib ]; then
  FILES=$(ls mobile/lib/*.dart 2>/dev/null | wc -l)
  echo "   عدد ملفات Dart: $FILES"
  if [ -f mobile/lib/crypto_service.dart ]; then
    pass "mobile/lib/crypto_service.dart موجود"
  else
    fail "mobile/lib/crypto_service.dart مفقود" "Flutter scaffold فقط، لم يُبنَ"
  fi
else
  fail "mobile/lib/ غير موجود" "Flutter لم يُنشأ"
fi

info "تشغيل الخادم..."
export JWT_SECRET="test-secret-for-validation-only-$(date +%s)"
export DATA_DIR="$(pwd)/server/data-test"
rm -rf "$DATA_DIR"

cd server
node server.js > $TMPDIR/rasan-server.log 2>&1 &
SERVER_PID=$!
cd ..

READY=0
for i in $(seq 1 20); do
  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then READY=1; break; fi
  sleep 0.5
done

if [ $READY -eq 1 ]; then
  pass "الخادم يعمل على المنفذ 3000"
else
  fail "الخادم لم يبدأ" "راجع $TMPDIR/rasan-server.log"
  echo "--- آخر 30 سطر من السجل ---"
  tail -30 $TMPDIR/rasan-server.log
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

HEALTH=$(curl -s http://localhost:3000/health)
echo "$HEALTH" | grep -q '"ok":true' && pass "Health endpoint" || fail "Health endpoint" "$HEALTH"

USER1="test_$(date +%s)"
PUBKEY="QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="
REG=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER1\",\"password\":\"secret123\",\"publicKey\":\"$PUBKEY\"}")

TOKEN=$(echo "$REG" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$TOKEN" ]; then
  pass "تسجيل مستخدم ($USER1)"
else
  fail "تسجيل مستخدم" "$REG"
fi

LOGIN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER1\",\"password\":\"secret123\"}")
echo "$LOGIN" | grep -q '"token"' && pass "تسجيل دخول" || fail "تسجيل دخول" "$LOGIN"

ME=$(curl -s http://localhost:3000/api/auth/me -H "Authorization: Bearer $TOKEN")
echo "$ME" | grep -q "\"username\":\"$USER1\"" && pass "جلب بياناتي" || fail "جلب بياناتي" "$ME"

CONV=$(curl -s -X POST http://localhost:3000/api/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"group","name":"اختبار","members":[]}')
CONV_ID=$(echo "$CONV" | grep -o '"id":[0-9]*' | cut -d: -f2)
if [ -n "$CONV_ID" ]; then
  pass "إنشاء مجموعة (id=$CONV_ID)"
else
  fail "إنشاء مجموعة" "$CONV"
fi

KEYBULK=$(curl -s -X POST "http://localhost:3000/api/conversations/$CONV_ID/group-key/bulk" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entries\":[{\"userId\":1,\"wrapped_key\":\"AAAA\",\"iv\":\"BBBB\"}],\"key_version\":2}")
echo "$KEYBULK" | grep -q '"ok":true' && pass "رفع group key (transaction يعمل)" || fail "رفع group key (transaction قد يكون مكسورًا في node:sqlite)" "$KEYBULK"

MSGS=$(curl -s "http://localhost:3000/api/conversations/$CONV_ID/messages" \
  -H "Authorization: Bearer $TOKEN")
echo "$MSGS" | grep -q '"messages"' && pass "جلب رسائل المجموعة" || fail "جلب رسائل المجموعة" "$MSGS"

info "اختبار rate limit (25 محاولة دخول خاطئة)..."
LAST_CODE=""
for i in $(seq 1 25); do
  LAST_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"nonexistent","password":"wrong"}')
done
if [ "$LAST_CODE" = "429" ]; then
  pass "Rate limit يعمل (429 بعد 25 محاولة)"
else
  fail "Rate limit" "آخر كود: $LAST_CODE (المتوقع 429)"
fi

[ -f server/data-test/rasan.db ] && pass "قاعدة البيانات محفوظة على القرص" || fail "قاعدة البيانات" "لم تُنشأ في server/data-test/"

WEB=$(curl -s http://localhost:3000/)
echo "$WEB" | grep -q '<title>' && pass "الصفحة الرئيسية تُحمّل" || fail "الصفحة الرئيسية" "لا تحتوي HTML"

if grep -q '\[push\] disabled' $TMPDIR/rasan-server.log; then
  info "Push معطّل (طبيعي بدون FCM credentials)"
else
  pass "Push مفعّل"
fi

ERRORS=$(grep -c 'ERROR\|Error:' "$TMPDIR/rasan-server.log" 2>/dev/null || true)
ERRORS=${ERRORS:-0}
if [ "$ERRORS" -gt 0 ]; then
  fail "أخطاء في سجل الخادم" "$ERRORS خطأ — راجع $TMPDIR/rasan-server.log"
else
  pass "لا أخطاء في سجل الخادم"
fi

kill $SERVER_PID 2>/dev/null
sleep 1

echo ""
echo "========================================"
echo "  الملخص:"
echo -e "  ${GREEN}نجح: $PASS${NC}"
echo -e "  ${RED}فشل: $FAIL${NC}"
echo "========================================"
echo ""
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}🎉 كل الاختبارات نجحت. التطبيق جاهز للنشر.${NC}"
  exit 0
else
  echo -e "${RED}⚠  هناك $FAIL فشل. أرسل هذا الناتج كاملاً.${NC}"
  exit 1
fi
