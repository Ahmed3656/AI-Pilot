FROM node:22-alpine AS javascript

WORKDIR /workspace
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci
ENV EXPO_PUBLIC_API_URL=http://localhost:8080 \
    EXPO_PUBLIC_AUTH_REQUIRED=true
COPY . .
RUN npm run locks:check \
    && npm run format:check:js \
    && npm run lint:api \
    && npm run lint:mobile \
    && npm run typecheck \
    && npm run test:contract \
    && npm run test:infra \
    && npm run test:api \
    && npm run test:mobile \
    && npm run build:api \
    && npm run typecheck:mobile \
    && npm run build:mobile:web

FROM python:3.12-slim AS python

WORKDIR /workspace
COPY services/ai-service/requirements-dev.lock.txt /tmp/requirements-dev.lock.txt
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements-dev.lock.txt
COPY services/ai-service services/ai-service
RUN pip install --no-cache-dir --no-deps -e services/ai-service \
    && python -m ruff check services/ai-service \
    && python -m ruff format --check services/ai-service \
    && python -m pytest services/ai-service/tests \
    && python -m compileall -q services/ai-service/src
