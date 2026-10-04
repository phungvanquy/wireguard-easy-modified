#!/usr/bin/env bash
set -euo pipefail

image=${1:-wg-easy:ci}
container="wg-easy-smoke-$RANDOM-$RANDOM"

cleanup() {
  status=$?
  if (( status != 0 )); then
    docker logs "$container" || true
  fi
  docker rm --force --volumes "$container" > /dev/null 2>&1 || true
}
trap cleanup EXIT

password_hash=$(docker run --rm "$image" node -e \
  'console.log(require("bcryptjs").hashSync("ci-test-password", 4))')

docker run --detach --name "$container" \
  --cap-add NET_ADMIN \
  --sysctl net.ipv4.conf.all.src_valid_mark=1 \
  --sysctl net.ipv4.ip_forward=1 \
  --env WG_HOST=127.0.0.1 \
  --env "PASSWORD_HASH=$password_hash" \
  --env ENABLE_TRAFFIC_QUOTA=true \
  --health-interval=1s --health-start-period=1s --health-retries=30 \
  "$image" > /dev/null

for attempt in {1..30}; do
  state=$(docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' "$container")
  if [[ "$state" == 'running healthy' ]]; then
    break
  fi
  if [[ "$state" != running* ]] || (( attempt == 30 )); then
    echo "Container did not become healthy: $state" >&2
    exit 1
  fi
  sleep 1
done

docker exec -i "$container" node <<'JS'
const assert = require('node:assert/strict');

(async () => {
  const base = 'http://127.0.0.1:51821';
  const request = (path, options = {}) => fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(5000),
    ...options,
  });

  const page = await request('/');
  assert.equal(page.status, 200, 'Web UI is available');
  assert.match(await page.text(), /<html/i);
  const css = await request('/css/app.css');
  assert.equal(css.status, 200, 'Generated stylesheet is available');
  assert.ok((await css.text()).length > 1000);

  const session = await request('/api/session');
  assert.deepEqual(await session.json(), { requiresPassword: true, authenticated: false });
  const unauthorized = await request('/api/wireguard/client');
  assert.equal(unauthorized.status, 401, 'Client data requires authentication');
  const invalidAuth = await request('/api/wireguard/client', {
    headers: { authorization: 'incorrect-password' },
  });
  assert.equal(invalidAuth.status, 401, 'An invalid API password is rejected');
  const validAuth = await request('/api/wireguard/client', {
    headers: { authorization: 'ci-test-password' },
  });
  assert.equal(validAuth.status, 200, 'A valid API password is accepted');

  const login = await request('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'ci-test-password' }),
  });
  assert.equal(login.status, 200, 'Login succeeds');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = async (path, method = 'GET', body) => {
    const response = await request(path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, 200, `${method} ${path}`);
    return response.json();
  };

  await api('/api/wireguard/client', 'POST', { name: 'CI test', trafficQuota: 1048576 });
  const clients = await api('/api/wireguard/client');
  assert.equal(clients.length, 1);
  assert.equal(clients[0].name, 'CI test');
  assert.equal(clients[0].trafficQuota, 1048576);
  assert.equal(clients[0].enabled, true);
  const clientPath = `/api/wireguard/client/${clients[0].id}`;

  const config = await request(`${clientPath}/configuration`, { headers: { cookie } });
  assert.equal(config.status, 200);
  assert.match(await config.text(), /Endpoint = 127\.0\.0\.1:51820/);
  await api(`${clientPath}/disable`, 'POST');
  assert.equal((await api('/api/wireguard/client'))[0].enabled, false);
  await api(`${clientPath}/enable`, 'POST');
  assert.equal((await api('/api/wireguard/client'))[0].enabled, true);
  const backup = await api('/api/wireguard/backup');
  assert.ok(backup.clients[clients[0].id], 'Backup includes the client');
  await api(clientPath, 'DELETE');
  assert.equal((await api('/api/wireguard/client')).length, 0);
  await api('/api/wireguard/restore', 'PUT', { file: JSON.stringify(backup) });
  assert.equal((await api('/api/wireguard/client')).length, 1);

  await api('/api/session', 'DELETE');
  const loggedOut = await request('/api/wireguard/client', { headers: { cookie } });
  assert.equal(loggedOut.status, 401, 'Logout invalidates the session');
  console.log('Container smoke test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
JS
