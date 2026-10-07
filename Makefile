# Thin wrapper over npm and scripts/. `make help` lists targets. ENV=dev|prod selects the environment.
ENV ?= dev
TF_DIR := infra/terraform
TF ?= $(shell command -v terraform 2>/dev/null || command -v tofu 2>/dev/null)

.DEFAULT_GOAL := help
.PHONY: help install test lint check build dev fmt tf-fmt tf-validate shellcheck smoke bootstrap deploy seed doctor rollback teardown

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

install: ## npm ci
	npm ci

test: ## Unit tests for all workspaces
	npm test

lint: ## Repo guard rails (secrets, AUTH_MODE, JSON, CSP, ...)
	node scripts/lint.mjs

build: ## Build both static sites into apps/*/dist
	npm run build:web

dev: ## Local dev server (in-memory store, dev auth)
	npm run dev

tf-fmt: ## terraform fmt -check
	$(TF) -chdir=$(TF_DIR) fmt -check -recursive

tf-validate: ## terraform init -backend=false + validate (needs network for providers)
	$(TF) -chdir=$(TF_DIR) init -backend=false -input=false
	$(TF) -chdir=$(TF_DIR) validate

shellcheck: ## shellcheck all scripts
	shellcheck scripts/*.sh scripts/lib/*.sh

check: lint test build tf-fmt shellcheck ## Everything that runs offline

smoke: ## Smoke test a URL: make smoke URL=https://...
	scripts/smoke.sh $(URL)

bootstrap: ## One-time GCP bootstrap: make bootstrap ENV=dev GITHUB_REPO=owner/name
	scripts/bootstrap.sh --env $(ENV) $(if $(GITHUB_REPO),--github-repo $(GITHUB_REPO),)

deploy: ## Full local deploy to ENV
	scripts/deploy.sh --env $(ENV)

seed: ## Seed first admin: make seed ADMIN=you@example.com
	scripts/seed.sh --env $(ENV) --admin-email $(ADMIN)

doctor: ## Read-only environment health check
	scripts/doctor.sh --env $(ENV)

rollback: ## Roll a service back: make rollback SERVICE=blr-api
	scripts/rollback.sh --env $(ENV) --service $(SERVICE)

teardown: ## Destroy ENV (typed confirmation)
	scripts/teardown.sh --env $(ENV)
