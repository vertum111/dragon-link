// Bundles the Privy sign-in module (work/privy.js) into outputs/dragon-link/privy.bundle.js.
// Privy's SDK imports optional packages (Solana, Stripe) for features this game does not use;
// when one of them is not installed, its import resolves to an empty CommonJS shim. Installed ones are bundled
// as they are: Privy calls some of them (Coinbase Wallet SDK) at start-up even when they are never shown.
import { build } from 'esbuild';

const OPTIONAL = /^(@solana\/|@solana-program\/|@stripe\/|@coinbase\/wallet-sdk|@walletconnect\/|@farcaster\/)/;

const shimMissing = {
  name: 'shim-optional',
  setup(b) {
    b.onResolve({ filter: /^@/ }, async args => {
      if (/^@solana-program\//.test(args.path)) return { path: args.path, namespace: 'shim' };   // Solana-only programs; versions clash with @solana/kit
      if (!OPTIONAL.test(args.path) || args.pluginData?.retry) return;
      const r = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { retry: true } });
      return r.errors.length ? { path: args.path, namespace: 'shim' } : r;
    });
    b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  },
};

await build({
  entryPoints: ['work/privy.js'],
  bundle: true, format: 'esm', minify: true, platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  alias: { util: './work/chain/util-shim.js' },
  outfile: 'outputs/dragon-link/privy.bundle.js',
  plugins: [shimMissing],
  logLevel: 'warning', logLimit: 5,
});
console.log('privy.bundle.js built');
