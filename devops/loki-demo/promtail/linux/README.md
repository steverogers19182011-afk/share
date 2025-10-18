# Download
```
curl -L -O "https://github.com/grafana/loki/releases/download/v3.5.7/promtail-linux-amd64.zip"
```

# Install
```
sudo useradd --no-create-home --shell /usr/sbin/nologin promtail || true
sudo mkdir -p /etc/promtail /var/lib/promtail /usr/local/bin
sudo chown -R promtail:promtail /etc/promtail /var/lib/promtail

cd /tmp
sudo apt-get -y install unzip >/dev/null 2>&1 || true
unzip "promtail-linux-${ARCH}.zip"
sudo mv promtail-linux-${ARCH} /usr/local/bin/promtail
sudo chmod +x /usr/local/bin/promtail

sudo tee /etc/promtail/config.yml >/dev/null <<'YAML'
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /var/lib/promtail/positions.yaml

clients:
  - url: http://localhost:3100/loki/api/v1/push

scrape_configs:
  - job_name: varlogs
    static_configs:
      - targets: [localhost]
        labels:
          job: varlogs
          __path__: /var/log/**/*.log

  - job_name: journal
    journal:
      max_age: 12h
      labels:
        job: systemd-journal
    relabel_configs:
      - source_labels: ['__journal__systemd_unit']
        target_label: 'systemd_unit'
YAML
sudo chown promtail:promtail /etc/promtail/config.yml

sudo tee /etc/systemd/system/promtail.service >/dev/null <<'UNIT'
[Unit]
Description=Promtail service
Wants=network-online.target
After=network-online.target

[Service]
User=promtail
Group=promtail
# allow reading systemd journal files
SupplementaryGroups=systemd-journal
# increase file descriptors for many log files
LimitNOFILE=65536
ExecStart=/usr/local/bin/promtail \
  -config.file=/etc/promtail/config.yml \
  -client.external-labels=hostname=%H
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now promtail
```

Read logs while not running as root (if needed):
```
sudo usermod -a -G adm promtail
sudo systemctl restart promtail
```

# Test
## Service
```
systemctl status promtail --no-pager
curl -s localhost:9080/metrics | head
```

## End To End
Grafana -> Loki -> {job="varlogs"}
Grafana -> Loki -> {job="journal"}