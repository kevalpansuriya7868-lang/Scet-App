const net = require('net');

const normalize = (ip) => String(ip || '').replace(/^::ffff:/i, '');

/** Build an allow-list matcher from IPs / CIDRs (IPv4 or IPv6). */
function buildMatcher(entries) {
  const list = new net.BlockList();
  for (const entry of entries) {
    const [addr, prefix] = entry.split('/');
    if (!net.isIP(addr)) throw new Error(`Invalid ALLOWED_IPS entry: ${entry}`);
    const type = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
    if (prefix !== undefined) list.addSubnet(addr, Number(prefix), type);
    else list.addAddress(addr, type);
  }
  return (rawIp) => {
    const ip = normalize(rawIp);
    const family = net.isIP(ip);
    return family !== 0 && list.check(ip, family === 6 ? 'ipv6' : 'ipv4');
  };
}
module.exports = { buildMatcher, normalize };
