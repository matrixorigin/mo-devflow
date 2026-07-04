# mo-devflow all-in-one deployment

This compose stack runs the API, worker, and static web UI. MatrixOne stays
external and is reached through the MySQL protocol.

```bash
cd deployment/all-in-one
cp .env.example .env
docker compose up --build -d
docker compose ps
```

Default endpoints:

- Web: `http://localhost:5173`
- API health: `http://localhost:5173/health`
- Direct API bind: `127.0.0.1:18081`

The API service runs migrations on startup. The worker waits for the API health
check before starting, so schema creation completes before background jobs run.

For a MatrixOne instance on the host machine, keep
`MO_DEVFLOW_DB_HOST=host.docker.internal`. For a remote MatrixOne deployment,
replace the DB host, port, user, password, and database in `.env`.
