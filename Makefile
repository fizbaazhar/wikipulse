# Shortcuts for local development. Run `make help` to list them.
PY := backend/.venv/bin

.PHONY: help install backend replay frontend test test-backend test-frontend e2e e2e-selenium docker

help: ## List available commands
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-14s %s\n", $$1, $$2}'

install: ## Install back-end and front-end dependencies
	python3 -m venv backend/.venv
	$(PY)/pip install -r backend/requirements-dev.txt
	cd frontend && npm install

backend: ## Run the API against the live Wikipedia stream (port 8000)
	cd backend && .venv/bin/uvicorn --factory app.main:create_app --reload

replay: ## Run the API replaying the recorded sample at 10x speed
	cd backend && WIKIPULSE_SOURCE=replay WIKIPULSE_REPLAY_SPEED=10 .venv/bin/uvicorn --factory app.main:create_app --reload

frontend: ## Run the dashboard dev server (port 5173)
	cd frontend && npm run dev

test: test-backend test-frontend ## Run all unit and integration tests

test-backend: ## Back-end tests (pytest)
	cd backend && .venv/bin/python -m pytest

test-frontend: ## Front-end type check and tests (vitest)
	cd frontend && npm run typecheck && npm test

e2e: ## End-to-end browser test (Cypress, against the real back end on the sample)
	cd frontend && npm run e2e

e2e-selenium: ## The same flows in Selenium with C# (needs the .NET SDK and Chrome)
	cd frontend && npm run e2e:selenium

docker: ## Build and run everything with Docker on http://localhost:8080
	docker compose up --build
