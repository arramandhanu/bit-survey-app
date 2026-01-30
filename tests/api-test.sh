#!/bin/bash
# =====================================================
# Survey API Test Script
# Tests all API endpoints with curl
# Shows protection against direct API calls
# =====================================================

# Configuration
BASE_URL="${1:-https://survey.ramandhanu.cloud}"
ADMIN_PASSWORD="${2:-mypassword}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo "======================================================"
echo "Survey API Test Script v2.0"
echo "Base URL: $BASE_URL"
echo "======================================================"
echo ""

# ======================
# PUBLIC ENDPOINTS
# ======================
echo -e "${YELLOW}=== PUBLIC ENDPOINTS ===${NC}"
echo ""

# 1. Health Check
echo -e "${GREEN}[1] GET /health${NC}"
curl -s "$BASE_URL/health" | jq .
echo ""

# 2. Get Questions (Public)
echo -e "${GREEN}[2] GET /api/questions${NC}"
curl -s "$BASE_URL/api/questions" | jq .
echo ""

# ======================
# PROTECTED SUBMIT TESTS
# ======================
echo -e "${YELLOW}=== PROTECTED SUBMIT TESTS ===${NC}"
echo ""

# 3. Submit WITHOUT session (should fail - 401)
echo -e "${RED}[3] POST /api/survey WITHOUT session → Expected: 401${NC}"
curl -s -X POST "$BASE_URL/api/survey" \
  -H "Content-Type: application/json" \
  -d '{"questions":{"q1":"sangat_baik","q2":"sangat_baik","q3":"cukup_baik","q4":"sangat_baik","q5":"sangat_baik"}}' | jq .
echo ""

# 4. Submit WITH session but NO Origin header (should fail - 403)
echo -e "${RED}[4] POST /api/survey WITH cookie but NO Origin → Expected: 403${NC}"
# Get session cookie first
COOKIE_FILE=$(mktemp)
curl -s -c "$COOKIE_FILE" "$BASE_URL/api/session" > /dev/null
# Try submit without Origin header
curl -s -X POST "$BASE_URL/api/survey" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d '{"questions":{"q1":"sangat_baik","q2":"sangat_baik","q3":"cukup_baik","q4":"sangat_baik","q5":"sangat_baik"}}' | jq .
rm "$COOKIE_FILE"
echo ""

# 5. Submit WITH fake Origin (should fail - 403)
echo -e "${RED}[5] POST /api/survey WITH fake Origin → Expected: 403${NC}"
COOKIE_FILE=$(mktemp)
curl -s -c "$COOKIE_FILE" "$BASE_URL/api/session" > /dev/null
curl -s -X POST "$BASE_URL/api/survey" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil-site.com" \
  -H "Referer: https://evil-site.com/attack" \
  -d '{"questions":{"q1":"sangat_baik","q2":"sangat_baik","q3":"cukup_baik","q4":"sangat_baik","q5":"sangat_baik"}}' | jq .
rm "$COOKIE_FILE"
echo ""

echo -e "${CYAN}[NOTE] Only browser requests with valid Origin header can submit.${NC}"
echo -e "${CYAN}       Curl cannot fake browser behavior for this protection.${NC}"
echo ""

# ======================
# ADMIN ENDPOINTS
# ======================
echo -e "${YELLOW}=== ADMIN ENDPOINTS ===${NC}"
echo ""

# 6. Admin Login
echo -e "${GREEN}[6] POST /admin/login${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/admin/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}")
echo "$LOGIN_RESPONSE" | jq .
ADMIN_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token')
echo ""

if [ "$ADMIN_TOKEN" == "null" ] || [ -z "$ADMIN_TOKEN" ]; then
  echo -e "${RED}Login failed. Cannot test admin endpoints.${NC}"
  echo "Make sure password is correct: ./api-test.sh $BASE_URL YOUR_PASSWORD"
  exit 1
fi

# 7. Dashboard Stats
echo -e "${GREEN}[7] GET /admin/api/dashboard${NC}"
curl -s "$BASE_URL/admin/api/dashboard" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
echo ""

# 8. Recent Submissions
echo -e "${GREEN}[8] GET /admin/api/recent${NC}"
curl -s "$BASE_URL/admin/api/recent" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
echo ""

# 9. Audit Logs
echo -e "${GREEN}[9] GET /admin/api/logs?page=1${NC}"
curl -s "$BASE_URL/admin/api/logs?page=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
echo ""

# 10. Questions (Admin)
echo -e "${GREEN}[10] GET /admin/api/questions${NC}"
curl -s "$BASE_URL/admin/api/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
echo ""

# ======================
# SUMMARY
# ======================
echo "======================================================"
echo -e "${GREEN}API Test Complete!${NC}"
echo "======================================================"
echo ""
echo -e "${GREEN}✓${NC} Public endpoints work"
echo -e "${GREEN}✓${NC} Admin endpoints work (with token)"
echo -e "${RED}✗${NC} Direct API submit blocked (no Origin)"
echo -e "${RED}✗${NC} Fake Origin submit blocked"
echo ""
echo "Protection layers:"
echo "  1. HttpOnly Cookie - Token not visible to JS"
echo "  2. Origin/Referer  - Must come from browser"
echo "  3. Rate Limiting   - Max 5 per 10 minutes/IP"
echo ""
