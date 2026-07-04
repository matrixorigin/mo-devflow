.PHONY: help setup dev-init dev-start dev-ready dev-stop dev-clean dev-status dev-api-start dev-api-stop dev-api-logs dev-api-status dev-worker-start dev-worker-stop dev-worker-logs dev-worker-status dev-web-start dev-web-stop dev-web-logs dev-web-status dev-db-connect db-create db-migrate sync-once rules-once metrics-once drift-once notify-once format format-check check test ci

API_PID := api_server.pid
API_LOG := api_server.log
WORKER_PID := worker.pid
WORKER_LOG := worker.log
WEB_PID := web_server.pid
WEB_LOG := web_server.log
START_BG := node scripts/run-background.mjs
STOP_BG := node scripts/stop-background.mjs
WAIT_URL := node scripts/wait-for-url.mjs
WAIT_WORKER := node scripts/wait-for-worker-heartbeat.mjs
ASSERT_PORT_FREE := node scripts/assert-port-free.mjs

help:
	@echo "mo-devflow Development Commands"
	@echo "================================"
	@echo "  make setup              - Create .env and install dependencies"
	@echo "  make dev-init           - setup + db-create + db-migrate"
	@echo "  make dev-start          - Start API, worker, and web UI"
	@echo "  make dev-ready          - Wait for local API, worker, and web readiness"
	@echo "  make dev-stop           - Stop API, worker, and web UI"
	@echo "  make dev-clean          - Stop services and remove local runtime artifacts"
	@echo "  make dev-status         - Show service status"
	@echo "  make db-create          - Create dedicated MatrixOne database"
	@echo "  make db-migrate         - Run schema migrations"
	@echo "  make sync-once          - Run one GitHub sync pass"
	@echo "  make rules-once         - Recompute derived rules from cached data"
	@echo "  make metrics-once       - Recompute analytics metrics from cached data"
	@echo "  make drift-once         - Recompute AI drift signals from cached data"
	@echo "  make notify-once        - Process notification candidates"
	@echo "  make format             - Format source files"
	@echo "  make format-check       - Check source formatting"
	@echo "  make check              - Typecheck and test"
	@echo "  make ci                 - check + build"

setup:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env"; else echo ".env already exists"; fi
	@npm install

dev-init: setup db-create db-migrate

db-create:
	@set -a; [ -f .env ] && . ./.env; set +a; \
	mysql --protocol=TCP -h"$${MO_DEVFLOW_DB_HOST:-127.0.0.1}" -P"$${MO_DEVFLOW_DB_PORT:-6001}" -u"$${MO_DEVFLOW_DB_USER:-root}" --password="$${MO_DEVFLOW_DB_PASSWORD:-}" -e "CREATE DATABASE IF NOT EXISTS \`$${MO_DEVFLOW_DB_NAME:-mo_devflow}\`;"

db-migrate:
	@npm run db:migrate

sync-once:
	@npm run sync:once

rules-once:
	@npm run rules:once

metrics-once:
	@npm run metrics:once

drift-once:
	@npm run drift:once

notify-once:
	@npm run notify:once

dev-api-start:
	@set -a; [ -f .env ] && . ./.env; set +a; \
	started=0; \
	if [ -f $(API_PID) ] && kill -0 $$(cat $(API_PID)) 2>/dev/null; then \
		echo "API already running (PID $$(cat $(API_PID)))"; \
	else \
		$(ASSERT_PORT_FREE) 127.0.0.1 "$${MO_DEVFLOW_API_PORT:-18081}" API; \
		$(START_BG) $(API_PID) $(API_LOG) -- npm run start:api; \
		started=1; \
		echo "API starting (PID $$(cat $(API_PID)), log $(API_LOG))"; \
	fi; \
	if ! $(WAIT_URL) "http://127.0.0.1:$${MO_DEVFLOW_API_PORT:-18081}/health" API 30000; then \
		if [ "$$started" = "1" ]; then $(STOP_BG) $(API_PID) API; fi; \
		exit 1; \
	fi

dev-api-stop:
	@$(STOP_BG) $(API_PID) API

dev-api-logs:
	@tail -f $(API_LOG)

dev-api-status:
	@if [ -f $(API_PID) ] && kill -0 $$(cat $(API_PID)) 2>/dev/null; then echo "API running (PID $$(cat $(API_PID)))"; else echo "API not running"; fi

dev-worker-start:
	@set -a; [ -f .env ] && . ./.env; set +a; \
	started=0; \
	if [ -f $(WORKER_PID) ] && kill -0 $$(cat $(WORKER_PID)) 2>/dev/null; then \
		echo "Worker already running (PID $$(cat $(WORKER_PID)))"; \
	else \
		$(START_BG) $(WORKER_PID) $(WORKER_LOG) -- npm run dev:worker; \
		started=1; \
		echo "Worker starting (PID $$(cat $(WORKER_PID)), log $(WORKER_LOG))"; \
	fi; \
	if ! $(WAIT_WORKER) $(WORKER_PID) Worker 30000; then \
		if [ "$$started" = "1" ]; then $(STOP_BG) $(WORKER_PID) Worker; fi; \
		exit 1; \
	fi

dev-worker-stop:
	@$(STOP_BG) $(WORKER_PID) Worker

dev-worker-logs:
	@tail -f $(WORKER_LOG)

dev-worker-status:
	@if [ -f $(WORKER_PID) ] && kill -0 $$(cat $(WORKER_PID)) 2>/dev/null; then echo "Worker running (PID $$(cat $(WORKER_PID)))"; else echo "Worker not running"; fi

dev-web-start:
	@set -a; [ -f .env ] && . ./.env; set +a; \
	started=0; \
	if [ -f $(WEB_PID) ] && kill -0 $$(cat $(WEB_PID)) 2>/dev/null; then \
		echo "Web already running (PID $$(cat $(WEB_PID)))"; \
	else \
		$(ASSERT_PORT_FREE) 127.0.0.1 "$${MO_DEVFLOW_WEB_PORT:-5173}" Web; \
		$(START_BG) $(WEB_PID) $(WEB_LOG) -- npm --workspace @mo-devflow/web run dev -- --host 0.0.0.0; \
		started=1; \
		echo "Web starting (PID $$(cat $(WEB_PID)), log $(WEB_LOG))"; \
	fi; \
	if ! $(WAIT_URL) "http://127.0.0.1:$${MO_DEVFLOW_WEB_PORT:-5173}/" Web 30000; then \
		if [ "$$started" = "1" ]; then $(STOP_BG) $(WEB_PID) Web; fi; \
		exit 1; \
	fi

dev-web-stop:
	@$(STOP_BG) $(WEB_PID) Web

dev-web-logs:
	@tail -f $(WEB_LOG)

dev-web-status:
	@if [ -f $(WEB_PID) ] && kill -0 $$(cat $(WEB_PID)) 2>/dev/null; then echo "Web running (PID $$(cat $(WEB_PID)))"; else echo "Web not running"; fi

dev-start: dev-api-start dev-worker-start dev-web-start
	@$(MAKE) --no-print-directory dev-ready
	@set -a; [ -f .env ] && . ./.env; set +a; \
	echo "API: http://localhost:$${MO_DEVFLOW_API_PORT:-18081}"; \
	echo "Web: http://localhost:$${MO_DEVFLOW_WEB_PORT:-5173}"

dev-ready:
	@set -a; [ -f .env ] && . ./.env; set +a; \
	$(WAIT_URL) "http://127.0.0.1:$${MO_DEVFLOW_API_PORT:-18081}/health" API 30000; \
	$(WAIT_URL) "http://127.0.0.1:$${MO_DEVFLOW_API_PORT:-18081}/health" "Worker heartbeat" 30000 worker.status active; \
	$(WAIT_URL) "http://127.0.0.1:$${MO_DEVFLOW_WEB_PORT:-5173}/" Web 30000

dev-stop: dev-web-stop dev-worker-stop dev-api-stop

dev-clean: dev-stop
	@rm -f $(API_PID) $(WORKER_PID) $(WEB_PID) $(API_LOG) $(WORKER_LOG) $(WEB_LOG)
	@rm -rf apps/web/dist
	@echo "Removed local pid files, logs, and web build output"

dev-status: dev-api-status dev-worker-status dev-web-status

dev-db-connect:
	@set -a; [ -f .env ] && . ./.env; set +a; \
	mysql --protocol=TCP -h"$${MO_DEVFLOW_DB_HOST:-127.0.0.1}" -P"$${MO_DEVFLOW_DB_PORT:-6001}" -u"$${MO_DEVFLOW_DB_USER:-root}" --password="$${MO_DEVFLOW_DB_PASSWORD:-}" "$${MO_DEVFLOW_DB_NAME:-mo_devflow}"

test:
	@npm run test

format:
	@npm run format

format-check:
	@npm run format:check

check:
	@npm run check

ci:
	@npm run ci
