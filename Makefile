# Makefile — A2T 常用命令

.PHONY: up down logs ps doctor test typecheck build seed

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

## 环境体检
doctor:
	@echo "docker:  $$(docker --version 2>/dev/null || echo MISSING)"
	@echo "compose: $$(docker compose version 2>/dev/null || echo MISSING)"
	@echo "node:    $$(node --version 2>/dev/null || echo MISSING)"
	@echo "git:     $$(git --version 2>/dev/null || echo MISSING)"

## 安装依赖
install:
	npm ci

## 类型检查（全 workspace）
typecheck:
	npm run typecheck

## 运行测试（全 workspace）
test:
	npm test

## 构建 dashboard
build:
	npm run build --workspace @a2t/dashboard
