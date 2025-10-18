# Download
```
Invoke-WebRequest -Uri "https://github.com/grafana/loki/releases/download/v3.5.7/promtail-windows-amd64.exe.zip" -OutFile "promtail-windows-amd64.zip"
```

# Install
```
$LokiUrl = "http://server.lan:3100/loki/api/v1/push"  
# ------------------
$ErrorActionPreference = "Stop"
$BinDir   = "C:\Program Files\Promtail"
$DataDir  = "C:\ProgramData\Promtail"
$Config   = Join-Path $BinDir "config.yml"
$ExePath  = Join-Path $BinDir "promtail.exe"
$zip = "promtail-windows-amd64.zip"

New-Item -Force -ItemType Directory $BinDir, $DataDir | Out-Null
Expand-Archive -Path $zip -DestinationPath $env:TEMP -Force
Move-Item -Force (Join-Path $env:TEMP "promtail-$ARCH.exe") $ExePath

@"
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: C:\\ProgramData\\Promtail\\positions.yaml

clients:
  - url: $LokiUrl

scrape_configs:
  - job_name: winfiles
    static_configs:
      - targets: [localhost]
        labels:
          job: winfiles
          __path__: C:\\Logs\\**\\*.log
"@ | Set-Content -Encoding UTF8 $Config
```
- If your logs live elsewhere, change `__path__` accordingly. Use double backslashes in YAML.
- This tails `C:\Logs\**\*.log` and stores positions in `C:\ProgramData\Promtail`.
- Promtail can also read Windows Event Logs (Application/System/Security/etc.). This uses a `windows_events` scrape config and a bookmark file under `C:\ProgramData\Promtail`.

# Test Installation
```
& "$ExePath" "-config.file" "$Config"
```

# Install with NSSM
```
nssm install Promtail $ExePath
nssm set promtail appstdout output.log
nssm set Promtail AppParameters "-config.file=config.yml -client.external-labels=hostname=$env:COMPUTERNAME"
nssm set promtail AppStdout C:\Program Files\Promtail\stdout.log
nssm set promtail AppStderr C:\Program Files\Promtail\stderr.log
nssm start Promtail
```

# Test
## Service
```
nssm status promtail
Get-Content C:\Program Files\Promtail\stdout.log
Get-Content C:\Program Files\Promtail\stderr.log
Invoke-Webrequest http://localhost:9080/metrics
```

## End To End
```
New-Item -Type Directory C:\Logs
@"
a
b
c
d
e
"@ | Set-Content -Encoding UTF8 c:\logs\test.log
```
Grafana -> Loki -> {job="winfiles"}
