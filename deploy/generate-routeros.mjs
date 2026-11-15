#!/usr/bin/env node
// Generate a one-time RouterOS provisioning script from a local JSON manifest.
// The generated file contains secrets: keep it private and delete it after import.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input = process.argv[2];
const output = process.argv[3] ?? 'mikrolink-install.rsc';
if (!input) {
  console.error('Usage: node deploy/generate-routeros.mjs deploy/site.json [output.rsc]');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(resolve(input), 'utf8'));
const required = (name) => {
  const value = raw[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
};
const safe = (name, pattern) => {
  const value = required(name);
  if (!pattern.test(value)) throw new Error(`Invalid ${name}`);
  return value;
};
const host = safe('publicHost', /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/i);
if (host.split('.').length < 2 || host.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
  throw new Error('publicHost must be a valid public DNS name');
}
const image = safe('containerImage', /^[a-z0-9][a-z0-9._:/@-]+$/i);
const imageParts = image.split('/');
let registryUrl = 'https://registry-1.docker.io';
let remoteImage = image;
if (imageParts.length > 1 && (imageParts[0].includes('.') || imageParts[0].includes(':'))) {
  const registryHost = imageParts.shift().toLowerCase();
  registryUrl = ['docker.io', 'index.docker.io', 'registry-1.docker.io'].includes(registryHost)
    ? 'https://registry-1.docker.io'
    : `https://${registryHost}`;
  remoteImage = imageParts.join('/');
}
if (!remoteImage || remoteImage.startsWith('/') || remoteImage.endsWith('/')) {
  throw new Error('containerImage must include an image path after the registry host');
}
const disk = safe('disk', /^[a-z0-9][a-z0-9._-]*$/i);
const routerUser = safe('routerOsUser', /^[a-z0-9][a-z0-9._-]*$/i);
const routerPassword = required('routerOsPassword');
const adminKey = required('adminKey');
const tokenSecret = required('tokenSecret');
const radiusSecret = required('radiusSecret');
if (routerPassword.length < 16 || [adminKey, tokenSecret, radiusSecret].some((s) => s.length < 32)) {
  throw new Error('routerOsPassword must have 16+ characters; adminKey/tokenSecret/radiusSecret need 32+ characters');
}
if (new Set([routerPassword, adminKey, tokenSecret, radiusSecret]).size !== 4 ||
    [routerPassword, adminKey, tokenSecret, radiusSecret].some((s) => s.startsWith('REPLACE_'))) {
  throw new Error('Use four different real secrets; example placeholders are rejected');
}
const wgPort = Number(raw.wgPort ?? 51820);
const ovpnPort = Number(raw.ovpnPort ?? 1194);
if (![wgPort, ovpnPort].every((n) => Number.isInteger(n) && n >= 1024 && n <= 65535)) {
  throw new Error('wgPort and ovpnPort must be ports from 1024 to 65535');
}
const ovpnTransport = raw.ovpnTransport ?? 'tcp';
if (!['tcp', 'udp'].includes(ovpnTransport)) throw new Error('ovpnTransport must be tcp or udp');
const wgDns = raw.wgDns ?? '1.1.1.1';
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(wgDns) || wgDns.split('.').some((part) => Number(part) > 255)) {
  throw new Error('wgDns must be IPv4');
}
const q = (value) => {
  const s = String(value);
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Error('Control characters are not allowed in RouterOS values');
  return `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')}"`;
};
const lines = [];
const add = (...values) => lines.push(...values);
const once = (path, selector, command) => add(`:if ([:len [${path}/find where ${selector}]] = 0) do={ ${command} }`);
const env = (key, value) => add(`/container/envs/add list=mikrolink-env key=${key} value=${q(value)}`);
const envExpr = (key, expression) => add(`/container/envs/add list=mikrolink-env key=${key} value=${expression}`);
const firewall = (comment, command) => once('/ip/firewall/filter', `comment=${q(comment)}`, `/ip/firewall/filter/add ${command} comment=${q(comment)} place-before=([/ip/firewall/filter/find where chain=input]->0)`);
const forward = (comment, command) => once('/ip/firewall/filter', `comment=${q(comment)}`, `/ip/firewall/filter/add ${command} comment=${q(comment)} place-before=([/ip/firewall/filter/find where chain=forward]->0)`);
const nat = (comment, command) => once('/ip/firewall/nat', `comment=${q(comment)}`, `/ip/firewall/nat/add ${command} comment=${q(comment)}`);

add('# MikroLink RouterOS 7.24.6 CHR bootstrap. Generated locally; contains credentials.');
add('# Prerequisites: public DNS resolves to this router; TCP/80 reaches it for ACME.');
add('# Install container and user-manager packages and enable container device-mode first.');
add(':if ([:len [/system/package/find where name="container"]] = 0) do={ :error "container package missing" }');
add(':if ([:len [/system/package/find where name="user-manager"]] = 0) do={ :error "user-manager package missing" }');
add(':if ([/system/device-mode/get container] != "yes") do={ :error "enable container device-mode and physically confirm first" }');
add(`:if ([:len [/file/find where name=${q(disk)}]] = 0) do={ :error "configured storage disk is missing" }`);
add(':if ([:len [/interface/list/find where name="WAN"]] = 0) do={ :error "WAN interface list is required" }');
add(':if ([:len [/ip/firewall/filter/find where chain=input]] = 0) do={ :error "input firewall chain is required" }');
add(':if ([:len [/ip/firewall/filter/find where chain=forward]] = 0) do={ :error "forward firewall chain is required" }');
firewall('mikrolink-acme-http', 'chain=input action=accept in-interface-list=WAN protocol=tcp dst-port=80');
add(`:if ([:len [/certificate/find where common-name=${q(host)}]] = 0) do={ /certificate/add-acme name=mikrolink-acme domain-names=${q(host)} }`);
add(':delay 10s');
add(`:local tlsCert [/certificate/find where common-name=${q(host)}]`);
add(':if ([:len $tlsCert] = 0) do={ :error "ACME certificate missing; check DNS and TCP/80, then rerun" }');
add(':local tlsName [/certificate/get $tlsCert name]');
add('');
add('# Private container network and HTTPS RouterOS REST endpoint.');
once('/interface/veth', 'name="mikrolink-veth"', '/interface/veth/add name=mikrolink-veth address=172.31.222.2/30 gateway=172.31.222.1');
once('/ip/address', 'interface="mikrolink-veth"', '/ip/address/add address=172.31.222.1/30 interface=mikrolink-veth');
once('/user/group', 'name="mikrolink-rest"', '/user/group/add name=mikrolink-rest policy=read,write,api,rest-api');
once('/user', `name=${q(routerUser)}`, `/user/add name=${q(routerUser)} group=mikrolink-rest address=172.31.222.2/32 password=${q(routerPassword)}`);
add('/ip/service/set www-ssl disabled=no port=8443 available-from=172.31.222.2/32 tls-version=only-1.2 certificate=$tlsName');
add('/ip/service/webserver/set rest-plain=no index-secure=no webfig-secure=no graphs-secure=no');
add('');
add('# WireGuard server, OpenVPN server, IKEv2 server, and RADIUS accounting.');
once('/interface/wireguard', 'name="bridge-wg"', `/interface/wireguard/add name=bridge-wg listen-port=${wgPort} mtu=1420`);
once('/ip/address', 'interface="bridge-wg"', '/ip/address/add address=10.77.0.1/24 interface=bridge-wg');
add(':local wgPublic [/interface/wireguard/get [find where name="bridge-wg"] public-key]');
once('/ip/pool', 'name="mikrolink-ovpn-pool"', '/ip/pool/add name=mikrolink-ovpn-pool ranges=10.78.0.2-10.78.0.254');
once('/ppp/profile', 'name="mikrolink-ovpn"', `/ppp/profile/add name=mikrolink-ovpn local-address=10.78.0.1 remote-address=mikrolink-ovpn-pool dns-server=${wgDns}`);
once('/interface/ovpn-server/server', 'name="mikrolink-ovpn"', `/interface/ovpn-server/server/add name=mikrolink-ovpn port=${ovpnPort} protocol=${ovpnTransport} mode=ip certificate=$tlsName default-profile=mikrolink-ovpn require-client-certificate=no tls-version=only-1.2 auth=sha256 cipher=aes256-cbc redirect-gateway=def1`);
once('/user-manager/router', 'name="mikrolink-local"', `/user-manager/router/add name=mikrolink-local address=127.0.0.1 shared-secret=${q(radiusSecret)}`);
add('/user-manager/set enabled=yes use-profiles=yes certificate=$tlsName');
once('/radius', 'comment="mikrolink-radius"', `/radius/add address=127.0.0.1 secret=${q(radiusSecret)} service=ipsec,ppp comment=mikrolink-radius`);
add('/ppp/aaa/set use-radius=yes accounting=yes interim-update=1m');
add('/ip/ipsec/settings/set accounting=yes interim-update=1m');
add('/radius/incoming/set accept=yes');
once('/ip/ipsec/profile', 'name="mikrolink-ike2"', '/ip/ipsec/profile/add name=mikrolink-ike2');
once('/ip/ipsec/proposal', 'name="mikrolink-ike2"', '/ip/ipsec/proposal/add name=mikrolink-ike2 pfs-group=none');
once('/ip/pool', 'name="mikrolink-ike2-pool"', '/ip/pool/add name=mikrolink-ike2-pool ranges=10.79.0.2-10.79.0.254');
once('/ip/ipsec/mode-config', 'name="mikrolink-ike2"', `/ip/ipsec/mode-config/add name=mikrolink-ike2 address-pool=mikrolink-ike2-pool address-prefix-length=32 system-dns=no static-dns=${wgDns}`);
once('/ip/ipsec/policy/group', 'name="mikrolink-ike2"', '/ip/ipsec/policy/group/add name=mikrolink-ike2');
once('/ip/ipsec/policy', 'group="mikrolink-ike2"', '/ip/ipsec/policy/add dst-address=10.79.0.0/24 group=mikrolink-ike2 proposal=mikrolink-ike2 src-address=0.0.0.0/0 template=yes');
once('/ip/ipsec/peer', 'name="mikrolink-ike2"', '/ip/ipsec/peer/add exchange-mode=ike2 name=mikrolink-ike2 passive=yes profile=mikrolink-ike2');
once('/ip/ipsec/identity', 'peer="mikrolink-ike2"', '/ip/ipsec/identity/add auth-method=eap-radius certificate=$tlsName generate-policy=port-strict mode-config=mikrolink-ike2 peer=mikrolink-ike2 policy-template-group=mikrolink-ike2');
add('');
add('# Public HTTPS API and tunnel ports. REST remains reachable only from veth.');
once('/ip/reverse-proxy', `sni=${q(host)}`, `/ip/reverse-proxy/add sni=${q(host)} ip-address=172.31.222.2 port=8080 certificate=$tlsName`);
firewall('mikrolink-rest-internal', 'chain=input action=accept src-address=172.31.222.2/32 protocol=tcp dst-port=8443');
firewall('mikrolink-rest-block-wan', 'chain=input action=drop in-interface-list=WAN protocol=tcp dst-port=8443');
firewall('mikrolink-api-https', 'chain=input action=accept in-interface-list=WAN protocol=tcp dst-port=443');
firewall('mikrolink-wireguard', `chain=input action=accept in-interface-list=WAN protocol=udp dst-port=${wgPort}`);
firewall('mikrolink-openvpn', `chain=input action=accept in-interface-list=WAN protocol=${ovpnTransport} dst-port=${ovpnPort}`);
firewall('mikrolink-ikev2', 'chain=input action=accept in-interface-list=WAN protocol=udp dst-port=500,4500');
firewall('mikrolink-ikev2-esp', 'chain=input action=accept in-interface-list=WAN protocol=ipsec-esp');
once('/ip/firewall/filter', 'comment="mikrolink-api-private-veth"', '/ip/firewall/filter/add chain=forward action=drop dst-address=172.31.222.2 comment="mikrolink-api-private-veth" place-before=([/ip/firewall/filter/find where chain=forward]->0)');
forward('mikrolink-wg-internet', 'chain=forward action=accept src-address=10.77.0.0/24 out-interface-list=WAN');
forward('mikrolink-ovpn-internet', 'chain=forward action=accept src-address=10.78.0.0/24 out-interface-list=WAN');
forward('mikrolink-ike2-internet', 'chain=forward action=accept src-address=10.79.0.0/24 out-interface-list=WAN');
forward('mikrolink-wg-return', 'chain=forward action=accept dst-address=10.77.0.0/24 in-interface-list=WAN connection-state=established,related');
forward('mikrolink-ovpn-return', 'chain=forward action=accept dst-address=10.78.0.0/24 in-interface-list=WAN connection-state=established,related');
forward('mikrolink-ike2-return', 'chain=forward action=accept dst-address=10.79.0.0/24 in-interface-list=WAN connection-state=established,related');
nat('mikrolink-wg-nat', 'chain=srcnat action=masquerade src-address=10.77.0.0/24 out-interface-list=WAN');
nat('mikrolink-ovpn-nat', 'chain=srcnat action=masquerade src-address=10.78.0.0/24 out-interface-list=WAN');
nat('mikrolink-ike2-nat', 'chain=srcnat action=masquerade src-address=10.79.0.0/24 out-interface-list=WAN');
nat('mikrolink-container-nat', 'chain=srcnat action=masquerade src-address=172.31.222.0/30 out-interface-list=WAN');
add('');
add('# OCI image, persistent data and environment. Reimporting does not erase data.');
add(`:if ([:len [/file/find where name=${q(`${disk}/mikrolink`)}]] = 0) do={ /file/add name=${q(`${disk}/mikrolink`)} type=directory }`);
once('/container/mounts', 'list="mikrolink-data"', `/container/mounts/add list=mikrolink-data src=${q(`${disk}/mikrolink/data`)} dst=/data`);
add('/container/envs/remove [find where list="mikrolink-env"]');
env('API_HOST', '0.0.0.0');
env('API_PORT', '8080');
env('API_BEHIND_PROXY', '1');
env('DATA_FILE', '/data/state.json');
env('TOKEN_SECRET', tokenSecret);
env('ADMIN_KEY', adminKey);
env('ROUTEROS_URL', `https://${host}:8443/rest`);
env('ROUTEROS_USER', routerUser);
env('ROUTEROS_PASSWORD', routerPassword);
env('PUBLIC_HOST', host);
env('WG_INTERFACE', 'bridge-wg');
envExpr('WG_SERVER_PUBLIC_KEY', '$wgPublic');
env('WG_PORT', wgPort);
env('WG_SUBNET', '10.77.0.0/24');
env('WG_DNS', wgDns);
env('OVPN_PORT', ovpnPort);
env('OVPN_TRANSPORT', ovpnTransport);
env('IKEV2_IDENTITY', host);
env('LEASE_SECONDS', '86400');
env('RECONCILE_SECONDS', '15');
add(`/container/config/set registry-url=${registryUrl} tmpdir=${q(`${disk}/mikrolink/tmp`)}`);
once('/container', 'name="mikrolink-api"', `/container/add name=mikrolink-api remote-image=${q(remoteImage)} interface=mikrolink-veth root-dir=${q(`${disk}/mikrolink/image`)} mountlists=mikrolink-data envlists=mikrolink-env hosts=${q(`${host}=172.31.222.1`)} start-on-boot=yes restart-policy=always dns=${wgDns}`);
add(':put "MikroLink configuration created. Wait for container extraction, then run /container/start mikrolink-api"');

writeFileSync(resolve(output), lines.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Wrote ${resolve(output)}. This file contains credentials; import it privately and remove it afterward.`);
