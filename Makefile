# Makefile — Agent Credit Lab 常用命令

.PHONY: up down logs ps doctor test lint seed

## 启动全部服务（后台）
up:
	docker compose up -d

## 停止全部服务
down:
	docker compose down

## 查看日志
logs:
	docker compose logs -f

## 查看状态
ps:
	docker compose ps

## 环境体检（Stage 0 起逐步实现 acl doctor）
doctor:
	@echo "docker:  $$(docker --version 2>/dev/null || echo MISSING)"
	@echo "compose: $$(docker compose version 2>/dev/null || echo MISSING)"
	@echo "python:  $$(python3 --version 2>/dev/null || echo MISSING)"
	@echo "node:    $$(node --version 2>/dev/null || echo MISSING)"
	@echo "git:     $$(git --version 2>/dev/null || echo MISSING)"

## 运行后端测试
test:
	cd apps/api && python -m pytest -q

## 代码检查
lint:
	cd apps/api && ruff check . 2>/dev/null || echo "ruff not installed"
