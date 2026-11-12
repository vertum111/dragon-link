// Browser stand-in for node's `util`, needed only by a JSON-schema helper inside near-api-js.
export function format(f, ...args) {
  let i = 0;
  return String(f).replace(/%[sdij%]/g, m => (m === '%%' ? '%' : m === '%j' ? JSON.stringify(args[i++]) : String(args[i++])));
}
export function inspect(x) { try { return JSON.stringify(x); } catch { return String(x); } }
export default { format, inspect };
