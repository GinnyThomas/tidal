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
# Requirements:
#   - iTerm2 installed (uses AppleScript to open panes)
#   - backend/.venv exists (run: cd backend && python -m venv .venv)
#   - frontend/node_modules exists (run: cd frontend && npm install)
#
# Usage:
#   chmod +x dev.sh   (first time only)
#   ./dev.sh

set -euo pipefail

# ── Colours for terminal output ─────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Colour

# ── Project root (directory containing this script) ──────────────────────────
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

# Check backend venv
if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo -e "${RED}✗ Backend virtual environment not found.${NC}"
  echo -e "  Run: cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

# Check backend .env
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo -e "${RED}✗ Backend .env file not found.${NC}"
  echo -e "  Run: cd backend && cp .env.example .env && fill in real values"
  exit 1
fi

# Check frontend node_modules
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
  # Wait for postgres to be ready
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

# Ensure tidal database exists
if psql -lqt | cut -d \| -f 1 | grep -qw tidal; then
  echo -e "${GREEN}✓ Database 'tidal' exists${NC}"
else
  echo -e "${BLUE}  Creating database 'tidal'...${NC}"
  createdb tidal
  echo -e "${GREEN}✓ Database 'tidal' created${NC}"
fi

echo ""

# ── Detect terminal and launch services ──────────────────────────────────────
#
# We support three launch modes:
#   1. iTerm2  — opens a new window with three panes (preferred)
#   2. Terminal.app — opens three separate windows
#   3. Fallback — runs all services in background with a log aggregator

echo -e "${YELLOW}── Launching services ───────────────────────────────${NC}"

# ── Mode 1: iTerm2 ────────────────────────────────────────────────────────────

if [ -d "/Applications/iTerm.app" ] || [ -d "$HOME/Applications/iTerm.app" ]; then
  echo -e "${BLUE}  iTerm2 detected — opening split panes...${NC}"

  osascript << APPLESCRIPT
tell application "iTerm2"
  activate

  -- Create a new window
  set newWindow to (create window with default profile)

  tell newWindow
    tell current session
      -- Pane 1: Backend (FastAPI)
      write text "cd '$BACKEND_DIR' && source .venv/bin/activate && clear && echo '🐍 FastAPI Backend — http://localhost:8000' && echo '📖 API Docs  — http://localhost:8000/docs' && echo '' && uvicorn app.main:app --reload --log-level info"
    end tell

    -- Split vertically for frontend
    set frontendSession to (split vertically with default profile)
    tell frontendSession
      write text "cd '$FRONTEND_DIR' && clear && echo '⚛️  React Frontend — http://localhost:5173' && echo '' && npm run dev"
    end tell

    -- Split the backend pane horizontally for a log/test pane
    tell current session
      set testSession to (split horizontally with default profile)
      tell testSession
        write text "cd '$BACKEND_DIR' && source .venv/bin/activate && clear && echo '🧪 Test Runner — run: pytest' && echo '   Watch mode: ptw (pip install pytest-watch)' && echo '   Run tests:   python -m pytest tests/ -v' && echo ''"
      end tell
    end tell
  end tell
end tell
APPLESCRIPT

  echo -e "${GREEN}✓ iTerm2 launched with 3 panes:${NC}"
  echo -e "   ${CYAN}Top-left:  FastAPI backend  (http://localhost:8000)${NC}"
  echo -e "   ${CYAN}Top-right: React frontend   (http://localhost:5173)${NC}"
  echo -e "   ${CYAN}Bottom:    Test runner pane${NC}"
  echo ""
  echo -e "${PURPLE}  API Docs: http://localhost:8000/docs${NC}"
  echo -e "${PURPLE}  Health:   http://localhost:8000/api/v1/health${NC}"

# ── Mode 2: Terminal.app ──────────────────────────────────────────────────────

elif [ "$TERM_PROGRAM" = "Apple_Terminal" ]; then
  echo -e "${BLUE}  Terminal.app detected — opening separate windows...${NC}"

  # Backend window
  osascript << APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd '$BACKEND_DIR' && source .venv/bin/activate && uvicorn app.main:app --reload"
end tell
APPLESCRIPT

  # Frontend window
  osascript << APPLESCRIPT
tell application "Terminal"
  do script "cd '$FRONTEND_DIR' && npm run dev"
end tell
APPLESCRIPT

  echo -e "${GREEN}✓ Launched in separate Terminal windows${NC}"

# ── Mode 3: Fallback (background processes + log tailing) ────────────────────

else
  echo -e "${BLUE}  Launching services in background...${NC}"

  LOG_DIR="$PROJECT_ROOT/.logs"
  mkdir -p "$LOG_DIR"

  # Start backend
  cd "$BACKEND_DIR"
  source .venv/bin/activate
  uvicorn app.main:app --reload --log-level info > "$LOG_DIR/backend.log" 2>&1 &
  BACKEND_PID=$!
  echo $BACKEND_PID > "$LOG_DIR/backend.pid"

  # Start frontend
  cd "$FRONTEND_DIR"
  npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
  FRONTEND_PID=$!
  echo $FRONTEND_PID > "$LOG_DIR/frontend.pid"

  echo -e "${GREEN}✓ Services started in background${NC}"
  echo -e "   Backend PID:  $BACKEND_PID"
  echo -e "   Frontend PID: $FRONTEND_PID"
  echo ""
  echo -e "${YELLOW}  Tailing logs (Ctrl+C to stop tailing — services keep running)${NC}"
  echo -e "${YELLOW}  To stop all services: ./dev-stop.sh${NC}"
  echo ""

  # Tail both logs with prefixes
  tail -f "$LOG_DIR/backend.log" | sed "s/^/$(echo -e ${BLUE})[backend]$(echo -e ${NC}) /" &
  tail -f "$LOG_DIR/frontend.log" | sed "s/^/$(echo -e ${GREEN})[frontend]$(echo -e ${NC}) /" &

  # Create a stop script
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
