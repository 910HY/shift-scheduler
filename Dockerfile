# 渣板 on one public port: Node builds the Vite UI, Python serves it with the solver.
# Render: set this service's runtime to Docker and leave the Docker command empty
# so this CMD is used. Bind address comes from $PORT (Render default 10000).

FROM node:22-bookworm-slim AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements-prod.txt /tmp/requirements-prod.txt
RUN pip install --no-cache-dir -r /tmp/requirements-prod.txt

COPY server ./server
COPY scripts/start-prod.sh ./scripts/start-prod.sh
COPY --from=frontend /src/dist ./dist
RUN chmod +x ./scripts/start-prod.sh

EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT','10000'), timeout=3)"

CMD ["./scripts/start-prod.sh"]
