#!/bin/bash
#
# dev.sh — Tidal development environment launcher
#
# Starts all services in separate iTerm2 profiles with colour-coded logs.
# Run from the project root: ./dev.sh
#
# Services started:
#   - PostgreSQL (if not already running)
#   - FastAPI backend (uvicorn, port 8000)
#   - React frontend (vite, port 5173)
#
# Usage:
#   chmod +x dev.sh   (first time only)
#   ./dev.sh

set -euo pipefail

# ── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Project root ─────────────────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

echo -e "${CYAN}"
echo "  ████████╗██╗██████╗  █████╗ ██╗     "
echo "     ██╔══╝██║██╔══██╗██╔══██╗██║     "
echo "     ██║   ██║██║  ██║███████║██║     "
echo "     ██║   ██║██║  ██║██╔══██║██║     "
echo "     ██║   ██║██████╔╝██║  ██║███████╗"
echo "     ╚═╝   ╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝"
echo -e "${NC}"
echo -e "${PURPLE}  Multi-currency personal finance tracker${NC}"
echo -e "${BLUE}  Starting development environment...${NC}"
echo ""

# ── Preflight checks ─────────────────────────────────────────────────────────
check_prereq() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "${RED}✗ $1 not found. $2${NC}"
    exit 1
  fi
}

echo -e "${YELLOW}── Preflight checks ────────────────────────────────${NC}"

check_prereq "psql" "Install PostgreSQL: brew install postgresql@16"
check_prereq "node" "Install Node: nvm install --lts"
check_prereq "python3" "Install Python: pyenv install 3.13.7"

if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo -e "${RED}✗ Backend virtual environment not found.${NC}"
  echo -e "  Run: cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo -e "${RED}✗ Backend .env file not found.${NC}"
  echo -e "  Run: cd backend && cp .env.example .env && fill in real values"
  exit 1
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo -e "${YELLOW}⚠ Frontend node_modules not found. Running npm install...${NC}"
  cd "$FRONTEND_DIR" && npm install
fi

echo -e "${GREEN}✓ All preflight checks passed${NC}"
echo ""

# ── Start PostgreSQL ──────────────────────────────────────────────────────────
echo -e "${YELLOW}── PostgreSQL ───────────────────────────────────────${NC}"

if pg_isready -q; then
  echo -e "${GREEN}✓ PostgreSQL already running${NC}"
else
  echo -e "${BLUE}  Starting PostgreSQL...${NC}"
  brew services start postgresql@16
  for i in {1..10}; do
    if pg_isready -q; then
      echo -e "${GREEN}✓ PostgreSQL started${NC}"
      break
    fi
    if [ $i -eq 10 ]; then
      echo -e "${RED}✗ PostgreSQL failed to start after 10 seconds${NC}"
      exit 1
    fi
    sleep 1
  done
fi

if psql -lqt | cut -d \| -f 1 | grep -qw tidal; then
  echo -e "${GREEN}✓ Database 'tidal' exists${NC}"
else
  echo -e "${BLUE}  Creating database 'tidal'...${NC}"
  createdb tidal
  echo -e "${GREEN}✓ Database 'tidal' created${NC}"
fi

echo ""

# ── Launch services ───────────────────────────────────────────────────────────
echo -e "${YELLOW}── Launching services ───────────────────────────────${NC}"

# ── Mode 1: iTerm2 ────────────────────────────────────────────────────────────
if [ -d "/Applications/iTerm.app" ] || [ -d "$HOME/Applications/iTerm.app" ]; then
  echo -e "${BLUE}  iTerm2 detected — opening split panes...${NC}"

  osascript - "$BACKEND_DIR" "$FRONTEND_DIR" << 'APPLESCRIPT'
on run argv
  set backendDir to item 1 of argv
  set frontendDir to item 2 of argv

  tell application "iTerm2"
    activate

    -- Create a new window
    set newWindow to (create window with default profile)
    set newTab to current tab of newWindow

    -- Pane 1 (left): FastAPI backend
    tell current session of newTab
      write text "cd '" & backendDir & "' && source .venv/bin/activate && clear && echo '🐍 FastAPI Backend — http://localhost:8000' && echo '📖 API Docs  — http://localhost:8000/docs' && echo '' && uvicorn app.main:app --reload --log-level info"

      -- Split left pane vertically to create right pane
      set frontendSession to (split vertically with default profile)
    end tell

    -- Pane 2 (right): React frontend
    tell frontendSession
      write text "cd '" & frontendDir & "' && clear && echo '⚛️  React Frontend — http://localhost:5173' && echo '' && npm run dev"

      -- Split right pane horizontally to create bottom pane
      set testSession to (split horizontally with default profile)
    end tell

    -- Pane 3 (bottom-right): test runner
    tell testSession
      write text "cd '" & backendDir & "' && source .venv/bin/activate && clear && echo '🧪 Test Runner' && echo '   Backend tests:  python -m pytest tests/ -v' && echo '   Frontend tests: cd " & frontendDir & " && npm run test:run' && echo ''"
    end tell

  end tell
end run
APPLESCRIPT

  echo -e "${GREEN}✓ iTerm2 launched with 3 panes:${NC}"
  echo -e "   ${CYAN}Left:         FastAPI backend  (http://localhost:8000)${NC}"
  echo -e "   ${CYAN}Top-right:    React frontend   (http://localhost:5173)${NC}"
  echo -e "   ${CYAN}Bottom-right: Test runner${NC}"
  echo ""
  echo -e "${PURPLE}  API Docs: http://localhost:8000/docs${NC}"
  echo -e "${PURPLE}  Health:   http://localhost:8000/api/v1/health${NC}"

# ── Mode 2: Terminal.app ──────────────────────────────────────────────────────
elif [ "$TERM_PROGRAM" = "Apple_Terminal" ]; then
  echo -e "${BLUE}  Terminal.app detected — opening separate windows...${NC}"

  osascript -e "tell application \"Terminal\" to activate" \
            -e "tell application \"Terminal\" to do script \"cd '$BACKEND_DIR' && source .venv/bin/activate && uvicorn app.main:app --reload\""

  osascript -e "tell application \"Terminal\" to do script \"cd '$FRONTEND_DIR' && npm run dev\""

  echo -e "${GREEN}✓ Launched in separate Terminal windows${NC}"

# ── Mode 3: Fallback (background processes) ───────────────────────────────────
else
  echo -e "${BLUE}  Launching services in background...${NC}"

  LOG_DIR="$PROJECT_ROOT/.logs"
  mkdir -p "$LOG_DIR"

  cd "$BACKEND_DIR"
  source .venv/bin/activate
  uvicorn app.main:app --reload --log-level info > "$LOG_DIR/backend.log" 2>&1 &
  BACKEND_PID=$!
  echo $BACKEND_PID > "$LOG_DIR/backend.pid"

  cd "$FRONTEND_DIR"
  npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
  FRONTEND_PID=$!
  echo $FRONTEND_PID > "$LOG_DIR/frontend.pid"

  echo -e "${GREEN}✓ Services started in background${NC}"
  echo -e "   Backend PID:  $BACKEND_PID"
  echo -e "   Frontend PID: $FRONTEND_PID"
  echo ""
  echo -e "${YELLOW}  Tailing logs (Ctrl+C stops tailing — services keep running)${NC}"
  echo -e "${YELLOW}  To stop all services: ./dev-stop.sh${NC}"
  echo ""

  tail -f "$LOG_DIR/backend.log" | sed "s/^/[backend] /" &
  tail -f "$LOG_DIR/frontend.log" | sed "s/^/[frontend] /" &

  cat > "$PROJECT_ROOT/dev-stop.sh" << STOPSCRIPT
#!/bin/bash
echo "Stopping Tidal development services..."
[ -f "$LOG_DIR/backend.pid" ] && kill \$(cat "$LOG_DIR/backend.pid") 2>/dev/null && echo "Backend stopped"
[ -f "$LOG_DIR/frontend.pid" ] && kill \$(cat "$LOG_DIR/frontend.pid") 2>/dev/null && echo "Frontend stopped"
rm -f "$LOG_DIR"/*.pid
STOPSCRIPT
  chmod +x "$PROJECT_ROOT/dev-stop.sh"

  wait
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Tidal is running 🌊${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
