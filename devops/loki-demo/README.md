# Loki Demo
# Deploy
## Loki & Grafana
```
docker compose up 
```

## Promtail
- Linux - `promtail/linux`
- Windows - `promtail/windows`
- K8s - `index.ts` -> `promtail()`

# Docs
- Loki docker-compose: "https://grafana.com/docs/loki/latest/setup/install/docker/"

# Compress
```bash
tar --exclude='node_modules' --exclude='.git' -czf app.tgz .
```

# TODO
## v1

- loki
    - configuration
- targets
    - output to files

## v2

- loki
    - k8s