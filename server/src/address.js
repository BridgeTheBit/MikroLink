'use strict';

function ipToNumber(ip) {
  const pieces = ip.split('.').map(Number);
  if (pieces.length !== 4 || pieces.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error('Invalid IPv4 address');
  return pieces.reduce((value, x) => ((value << 8) | x) >>> 0, 0);
}
function numberToIp(value) { return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.'); }

function allocateAddress(cidr, used) {
  const [ip, bitsText] = cidr.split('/');
  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 16 || bits > 30) throw new Error('WG_SUBNET must be an IPv4 /16 to /30');
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  const network = ipToNumber(ip) & mask;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const taken = new Set(used.map(x => String(x).split('/')[0]));
  for (let address = network + 2; address < broadcast; address++) {
    const candidate = numberToIp(address);
    if (!taken.has(candidate)) return `${candidate}/32`;
  }
  throw new Error('WireGuard address pool exhausted');
}

module.exports = { allocateAddress };
