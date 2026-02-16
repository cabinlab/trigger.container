# trigger.container

Containerized [Trigger.dev](https://trigger.dev) self-hosting. Fork of [triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev) for fully containerized deployments with cloud-parity features.

> **v4 only.** This fork targets the v4 supervisor/checkpoint/warm-start architecture exclusively. There is no v3 compatibility and no migration path from v3 Docker setups (coordinator/docker-provider). If you're running v3, start fresh.

## Quick Start

```bash
cd hosting/docker
./start.sh
```

This creates `.env` from `.env.example` (with optional secret generation), then brings up the full stack. Webapp is available at **http://localhost:8030** once healthy.

## What This Fork Adds

Trigger.dev's cloud platform includes features not yet available in the open-source self-hosted deployment. This fork carries patches that close that gap:

### Feature Branches

| Branch | Description |
|--------|-------------|
| `feat/self-hosted-checkpoint-service` | Enables container checkpointing for self-hosted deployments (requires CRIU on host). Allows long-running tasks to checkpoint/resume, matching cloud behavior. |
| `feat/warm-start-service` | Adds warm container reuse for self-hosted deployments. Reduces cold start latency by keeping recently-used task containers alive. Builds on checkpoint branch. |

These branches are maintained separately for upstream PR submission. They rebase on `main` as needed.

### Hosting Enhancements (on `main`)

The `hosting/docker/` directory includes deployment tooling beyond what upstream provides:

- **Combined compose file** — `docker-compose.yml` uses the `include` directive to run webapp + worker stacks together
- **Helper scripts** — `start.sh`, `stop.sh`, `update.sh` for full or split deployments
- **Explicit network naming** — predictable `trigger` network name for external service integration
- **Override-friendly** — drop a `docker-compose.override.yml` to customize (swap Postgres for external DB, add reverse proxy networks, etc.)

## Architecture

```mermaid
graph TB
    subgraph compose["hosting/docker/docker-compose.yml"]
        subgraph webapp_stack["webapp stack"]
            webapp["webapp<br/>(trigger.dev :8030)"]
            postgres["postgres"]
            redis["redis"]
            electric["electric"]
            clickhouse["clickhouse"]
            registry["registry"]
            minio["minio"]
        end
        subgraph worker_stack["worker stack"]
            supervisor["supervisor<br/>(task execution)"]
            checkpoint["checkpoint-service<br/>(optional, CRIU)"]
            proxy["docker-proxy<br/>(socket proxy)"]
        end
    end

    supervisor -->|API + OTEL| webapp
    checkpoint -->|API| webapp
    webapp --> postgres
    webapp --> redis
    webapp --> clickhouse
    electric --> postgres
    supervisor --> proxy
    checkpoint --> proxy

    trigger_net["network: trigger"]
    style trigger_net fill:none,stroke:#666,stroke-dasharray:5 5
```

**10 services total:**
- **webapp** — Trigger.dev application server (port 8030)
- **postgres** — PostgreSQL database (WAL logical replication)
- **redis** — Session store and caching
- **electric** — Real-time sync (ElectricSQL)
- **clickhouse** — Run analytics and observability
- **registry** — Docker image registry for deployed tasks
- **minio** — S3-compatible object storage
- **supervisor** — Manages task runner containers
- **checkpoint-service** — Container checkpointing (requires CRIU)
- **docker-proxy** — Secure Docker socket proxy

## Deployment Modes

### Full Stack (default)

Runs everything on a single machine:

```bash
./start.sh          # or: ./start.sh full
./stop.sh
./update.sh
```

### Split Deployment

Run webapp and worker on separate machines:

```bash
# Machine A (webapp)
./start.sh webapp

# Machine B (worker)
# Set TRIGGER_API_URL and OTEL_EXPORTER_OTLP_ENDPOINT in .env first
./start.sh worker
```

### Customization via Override

Create `hosting/docker/docker-compose.override.yml` to customize without modifying tracked files:

```yaml
services:
  postgres:
    profiles: ["disabled"]    # Use external database
  webapp:
    environment:
      DATABASE_URL: postgresql://user:pass@external-db:5432/trigger
```

## Configuration

All configuration is in `hosting/docker/.env`. Copy from `.env.example` (or let `start.sh` do it) and update:

- **Secrets** — `SESSION_SECRET`, `MAGIC_LINK_SECRET`, `ENCRYPTION_KEY`, `MANAGED_WORKER_SECRET` (generate with `openssl rand -hex 16`)
- **Origins** — `APP_ORIGIN`, `LOGIN_ORIGIN`, `API_ORIGIN` (set to your public URL in production)
- **Postgres** — `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_PASSWORD`
- **Registry** — `DOCKER_REGISTRY_URL`, `DOCKER_REGISTRY_PASSWORD`
- **Object Store** — `OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY`

See `.env.example` for the full list with documentation.

## Updating from Upstream

This fork tracks `triggerdotdev/trigger.dev`. To pull upstream changes:

```bash
# Add upstream remote (once)
git remote add upstream https://github.com/triggerdotdev/trigger.dev.git

# Fetch and merge
git fetch upstream
git merge upstream/main

# Rebase feature branches
git checkout feat/self-hosted-checkpoint-service
git rebase main
git checkout feat/warm-start-service
git rebase feat/self-hosted-checkpoint-service
```

### What We Diverge On

- `hosting/docker/` — enhanced deployment tooling (scripts, combined compose, network naming)
- `README.md` — this file (self-hosting focused vs. cloud-first)
- Feature branches — checkpoint and warm-start patches (pending upstream merge)

Source code on `main` is identical to upstream. Conflicts are limited to `README.md` and `hosting/docker/` files.

## Requirements

- Docker Engine 24+ with Compose v2.24+ (for `include` directive)
- 4GB+ RAM recommended (8GB+ for production)
- CRIU on host (only if using checkpoint-service)

## License

[Apache 2.0](LICENSE) — same as upstream Trigger.dev.
