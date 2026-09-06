# 12 反向代理与组网部署指南（W3）

状态：已验证配置形状（2026-09-04）。`dsh-remote` 自身已含令牌门禁与设备管理；本页只解决"如何让公网/异地设备安全地到达它"。局域网直连场景不需要本页——直接跑 `node scripts/start-lan.mjs` 即可。

## 0. 三条不变量

1. `dsh web` 永远只监听 loopback（上游刻意拒绝 `0.0.0.0`）；对外可达性由 `dsh-remote` 或它前面的反代提供。
2. 公网部署必须全程 HTTPS；明文 HTTP 只允许可信局域网/ mesh，且绝不端口转发。
3. 反代必须原样传递 WebSocket 升级（`Upgrade`/`Connection` 头），否则事件流（`/api/remote.mux`）会退化成 426/502。

## 1. Caddy（推荐，自动 HTTPS）

```
dsh.example.com {
    reverse_proxy 127.0.0.1:3081
}
```

就这些。Caddy 默认透传 WebSocket、自动签发 Let's Encrypt 证书。启动代理时告诉它自己的公网来源，二维码/配对链接才会用域名：

```sh
DSH_REMOTE_TOKEN=$(openssl rand -hex 16) \
DSH_PUBLIC_URL=https://dsh.example.com \
node proxy/dsh-remote.mjs
```

`requestOriginOk` 已支持"HTTPS 在前、明文在后"的终止模式（Origin 按 http/https 同主机比较），无需额外信任头。

## 2. Nginx

```nginx
server {
    listen 443 ssl;
    server_name dsh.example.com;
    # 证书路径按你的部署填写（certbot 或手工）
    ssl_certificate     /etc/letsencrypt/live/dsh.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dsh.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;              # 保留真实主机名（Origin 校验用）
        proxy_set_header Upgrade $http_upgrade;   # WebSocket 必需
        proxy_set_header Connection "upgrade";    # WebSocket 必需
        proxy_read_timeout 1h;                    # SSE / WS 长连接
        proxy_send_timeout 1h;
        proxy_buffering off;                      # 流式输出不缓冲
    }
}
```

注意：不要配置 `proxy_set_header X-Forwarded-*` 之外的头改写 `Origin`；`dsh-remote` 会自行剥除 Origin 再转发上游。

## 3. Tailscale / 私有 mesh（最省心的"公网"）

不需要证书与反代：Tailscale 网络本身可信，明文 HTTP + 令牌即可。

```sh
# 主机上（已安装 tailscale，假设其 tailnet IP 为 100.64.0.5）
DSH_REMOTE_TOKEN=$(openssl rand -hex 16) \
DSH_LISTEN_HOST=0.0.0.0 \
DSH_PUBLIC_URL=http://100.64.0.5:3081 \
node proxy/dsh-remote.mjs
```

手机安装 Tailscale 并登录同一 tailnet，扫描终端二维码即可。若启用 Tailscale 的 HTTPS（`tailscale cert`），把 `DSH_PUBLIC_URL` 换成 `https://<machine>.<tailnet>.ts.net` 并用 `DSH_TLS_CERT/KEY` 指向证书。

## 4. 管理台

浏览器打开 `https://<你的域名>/admin`，输入 `DSH_REMOTE_TOKEN` 后可：列出设备（名称/签发/最后使用/到期）、单独吊销、签发新配对码、下载 SVG 二维码。主令牌只保存在页面内存中。命令行等价操作：

```sh
curl -s -H "Authorization: Bearer $DSH_REMOTE_TOKEN" https://dsh.example.com/devices
curl -s -X POST -H "Authorization: Bearer $DSH_REMOTE_TOKEN" \
     -H 'content-type: application/json' -d '{"id":"<设备ID>"}' \
     https://dsh.example.com/devices/revoke
```

## 5. 故障对照

| 启动页/日志现象 | 原因 | 处理 |
|---|---|---|
| 连不上主机：超时 | 代理不可达 / 不在同一网络 | 确认监听端口、防火墙、同一 Wi-Fi 或 tailnet |
| 配对码无效或已过期 | 码被用掉 / 超 10 分钟 | 主机终端按 `n` 重新签发，或 /admin 签发 |
| 尝试过多 | 同 IP 一分钟内超过 `DSH_PAIR_RATE_MAX`（默认 10）次 | 稍后再试；测试环境可调高该值 |
| 代理在线，但上游 dsh web 未运行 | `dsh web` 未启动或端口不符 | 先起 `dsh web --port 3080`（`/healthz` 的 `upstream` 字段可用于探测） |
| 会话已过期，请重新配对 | 设备会话到期/被吊销 | 重新扫码配对；管理台可查吊销记录 |
| 设备登记文件损坏（启动退出） | `DSH_STATE_FILE` 被手工编辑/磁盘损坏 | 删除该文件（吊销全部设备）后重启，重新配对 |

## 6. 备份与轮换

- 备份 `DSH_STATE_FILE`（默认 `proxy/dsh-devices.json`）= 保留所有设备的登录态；删除 = 全员重新配对。
- 轮换主令牌：换 `DSH_REMOTE_TOKEN` 重启即吊销全部设备令牌（HMAC 密钥变更），登记表无需手工清理（列表会显示为过期并自动剪除）。
