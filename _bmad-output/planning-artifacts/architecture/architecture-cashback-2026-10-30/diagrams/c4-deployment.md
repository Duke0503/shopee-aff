# C4 Deployment — Production and development

Legend: production runs on one operator machine (currently a Mac) as host processes under launchd;
there are no containers in v1 (AD-25). Only the public listener is reachable from the internet, and
only through the Cloudflare tunnel. Development runs on a separate machine or the same machine with
every resource different (ports, database, Zalo account, Chrome profile, no tunnel).

```mermaid
C4Deployment
  title Deployment - production on the operator's machine

  Deployment_Node(phone, "Customer phone", "Android / iOS") {
    Container(zaloapp, "Zalo app", "Zalo", "Chat with the assistant")
    Container(webp, "Customer website", "Browser or Zalo in-app browser", "SPA bundle")
  }

  Deployment_Node(staffdev, "Staff laptop or phone", "Browser") {
    Container(adminp, "Admin desk", "Browser", "SPA bundle")
  }

  Deployment_Node(cfn, "Cloudflare", "Edge") {
    Container(edge, "Tunnel + Access", "Cloudflare", "TLS, hoantiendp.com and admin host; Access gate on admin host")
  }

  Deployment_Node(host, "Operator machine", "macOS, launchd, one production instance") {
    Container(cloudflared, "cloudflared", "launchd service", "Outbound tunnel to 127.0.0.1:8080")
    Container(serverp, "Server", "Node 24, launchd service", "Public 127.0.0.1:8080, internal 127.0.0.1:8081, all jobs")
    ContainerDb(dbp, "Ledger", "SQLite WAL file", "data/prod/cashback.db, local disk only")
    Container(assistantp, "Zalo assistant", "Node 24, launchd service", "Loopback 127.0.0.1:8082; production Zalo account")
    Deployment_Node(chrome, "Affiliate Chrome", "Chrome, own profile, started by script") {
      Container(bridgep, "Browser bridge", "MV3 extension", "Signed-in Shopee affiliate session")
    }
    ContainerDb(localbk, "Local backups", "backups/prod", "Pre-migration and daily copies")
  }

  Deployment_Node(remote, "Off-machine store", "rclone remote chosen by the owner") {
    ContainerDb(offbk, "Encrypted backups", "age-encrypted files", "30 daily + 12 monthly")
  }

  Rel(webp, edge, "HTTPS")
  Rel(adminp, edge, "HTTPS")
  Rel(edge, cloudflared, "Tunnel")
  Rel(cloudflared, serverp, "HTTP on loopback")
  Rel(serverp, dbp, "Reads and writes")
  Rel(assistantp, serverp, "Internal API")
  Rel(bridgep, serverp, "Internal API")
  Rel(serverp, assistantp, "Notifications")
  Rel(serverp, localbk, "Writes backups")
  Rel(localbk, offbk, "rclone copy, daily")
```

## Development environment (same shape, nothing shared)

| Resource | Production | Development |
| --- | --- | --- |
| Public listener | 127.0.0.1:8080 | 127.0.0.1:9080 |
| Internal listener | 127.0.0.1:8081 | 127.0.0.1:9081 |
| Assistant loopback | 127.0.0.1:8082 | 127.0.0.1:9082 |
| Database | data/prod/cashback.db | data/dev/cashback.db (seeded or a scrubbed copy) |
| Zalo account | production account | a second account, or the fake client |
| Chrome profile | .browser-profile/prod | .browser-profile/dev, or the fake bridge |
| Tunnel | cloudflared to hoantiendp.com | none |
| PUBLIC_BASE_URL | https://hoantiendp.com | empty |
| PID files | run/prod/*.pid | run/dev/*.pid |
| Secrets file | ~/.config/cashback/prod.env | ~/.config/cashback/dev.env |
