# One image with the back end and the built dashboard, for hosts that run a
# single container (Render: see render.yaml). Local development and
# docker-compose.yml use the separate back end and front end images instead.

# --- build the dashboard ---
FROM node:22-alpine AS dashboard
WORKDIR /web
# Cypress is a dev tool for the e2e tests; don't download its browser here.
ENV CYPRESS_INSTALL_BINARY=0
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- back end, serving the dashboard from /app/static ---
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WIKIPULSE_STATIC_DIR=/app/static

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/data ./data
COPY --from=dashboard /web/dist ./static

# Run as an unprivileged user; .state holds the AI spend counter.
RUN useradd --create-home --uid 10001 wikipulse && mkdir .state && chown wikipulse .state
USER wikipulse

# The host sets PORT (Render: 10000); 8000 when run by hand.
EXPOSE 8000
# --proxy-headers: the host's load balancer sends the browser's address in
# X-Forwarded-For, which the login throttle uses.
CMD ["sh", "-c", "exec uvicorn --factory app.main:create_app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
