.PHONY: help setup dev-init dev-start dev-stop dev-status dev-api-start dev-api-stop dev-api-logs dev-api-status dev-worker-start dev-worker-stop dev-worker-logs dev-worker-status dev-web-start dev-web-stop dev-web-logs dev-web-status dev-db-connect db-create db-migrate sync-once rules-once check test ci

API_PID := api_server.pid
API_LOG := api_server.log
WORKER_PID := worker.pid
WORKER_LOG := worker.log
WEB_PID := web_server.pid
WEB_LOG := web_server.log
START_BG := node scripts/run-background.mjs

help:
	@echo "mo-devflow Development Commands"
	@echo "================================"
	@echo "  make setup              - Create .env and install dependencies"
	@echo "  make dev-init           - setup + db-create + db-migrate"
	@echo "  make dev-start          - Start API, worker, and web UI"
	@echo "  make dev-stop           - Stop API, worker, and web UI"
	@echo "  make dev-status         - Show service status"
	@echo "  make db-create          - Create dedicated MatrixOne database"
	@echo "  make db-migrate         - Run schema migrations"
	@echo "  make sync-once          - Run one GitHub sync pass"
	@echo "  make rules-once         - Recompute derived rules from cached data"
	@echo "  make check              - Typecheck and test"
	@echo "  make ci                 - check + build"

setup:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env"; else echo ".env already exists"; fi
	@npm install

dev-init: setup db-create db-migrate

db-create:
	@set -a; [ -f .env ] && . ./.env; set +a; \
	mysql --protocol=TCP -h"$${MO_DEVFLOW_DB_HOST:-127.0.0.1}" -P"$${MO_DEVFLOW_DB_PORT:-6001}" -u"$${MO_DEVFLOW_DB_USER:-root}" -p"$${MO_DEVFLOW_DB_PASSWORD:-111}" -e "CREATE DATABASE IF NOT EXISTS \`$${MO_DEVFLOW_DB_NAME:-mo_devflow}\`;"

db-migrate:
	@npm run db:migrate

sync-once:
	@npm run sync:once

rules-once:
	@npm run rules:once

dev-api-start:
	@if [ -f $(API_PID) ] && kill -0 $$(cat $(API_PID)) 2>/dev/null; then echo "API already running (PID $$(cat $(API_PID)))"; exit 0; fi
	@$(START_BG) $(API_PID) $(API_LOG) -- npm run start:api
	@echo "API starting (PID $$(cat $(API_PID)), log $(API_LOG))"

dev-api-stop:
	@if [ -f $(API_PID) ]; then kill -TERM -$$(cat $(API_PID)) 2>/dev/null || kill $$(cat $(API_PID)) 2>/dev/null || true; rm -f $(API_PID); fi
	@echo "API stopped"

dev-api-logs:
	@tail -f $(API_LOG)

dev-api-status:
	@if [ -f $(API_PID) ] && kill -0 $$(cat $(API_PID)) 2>/dev/null; then echo "API running (PID $$(cat $(API_PID)))"; else echo "API not running"; fi

dev-worker-start:
	@if [ -f $(WORKER_PID) ] && kill -0 $$(cat $(WORKER_PID)) 2>/dev/null; then echo "Worker already running (PID $$(cat $(WORKER_PID)))"; exit 0; fi
	@$(START_BG) $(WORKER_PID) $(WORKER_LOG) -- npm run dev:worker
	@echo "Worker starting (PID $$(cat $(WORKER_PID)), log $(WORKER_LOG))"

dev-worker-stop:
	@if [ -f $(WORKER_PID) ]; then kill -TERM -$$(cat $(WORKER_PID)) 2>/dev/null || kill $$(cat $(WORKER_PID)) 2>/dev/null || true; rm -f $(WORKER_PID); fi
	@echo "Worker stopped"

dev-worker-logs:
	@tail -f $(WORKER_LOG)

dev-worker-status:
	@if [ -f $(WORKER_PID) ] && kill -0 $$(cat $(WORKER_PID)) 2>/dev/null; then echo "Worker running (PID $$(cat $(WORKER_PID)))"; else echo "Worker not running"; fi

dev-web-start:
	@if [ -f $(WEB_PID) ] && kill -0 $$(cat $(WEB_PID)) 2>/dev/null; then echo "Web already running (PID $$(cat $(WEB_PID)))"; exit 0; fi
	@$(START_BG) $(WEB_PID) $(WEB_LOG) -- npm --workspace @mo-devflow/web run dev -- --host 0.0.0.0
	@echo "Web starting (PID $$(cat $(WEB_PID)), log $(WEB_LOG))"

dev-web-stop:
	@if [ -f $(WEB_PID) ]; then kill -TERM -$$(cat $(WEB_PID)) 2>/dev/null || kill $$(cat $(WEB_PID)) 2>/dev/null || true; rm -f $(WEB_PID); fi
	@echo "Web stopped"

dev-web-logs:
	@tail -f $(WEB_LOG)

dev-web-status:
	@if [ -f $(WEB_PID) ] && kill -0 $$(cat $(WEB_PID)) 2>/dev/null; then echo "Web running (PID $$(cat $(WEB_PID)))"; else echo "Web not running"; fi

dev-start: dev-api-start dev-worker-start dev-web-start
	@echo "API: http://localhost:$${MO_DEVFLOW_API_PORT:-18081}"
	@echo "Web: http://localhost:$${MO_DEVFLOW_WEB_PORT:-5173}"

dev-stop: dev-web-stop dev-worker-stop dev-api-stop

dev-status: dev-api-status dev-worker-status dev-web-status

dev-db-connect:
	@set -a; [ -f .env ] && . ./.env; set +a; \
	mysql --protocol=TCP -h"$${MO_DEVFLOW_DB_HOST:-127.0.0.1}" -P"$${MO_DEVFLOW_DB_PORT:-6001}" -u"$${MO_DEVFLOW_DB_USER:-root}" -p"$${MO_DEVFLOW_DB_PASSWORD:-111}" "$${MO_DEVFLOW_DB_NAME:-mo_devflow}"

test:
	@npm run test

check:
	@npm run check

ci:
	@npm run ci
