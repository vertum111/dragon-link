// Bundles the Privy sign-in module (work/privy.js) into outputs/dragon-link/privy.bundle.js.
// Privy's SDK imports optional packages (Solana, Stripe) for features this game does not use;
// those imports always resolve to empty CommonJS shims, which also keeps the bundle small.
import { build } from 'esbuild';

const OPTIONAL = /^(@solana\/|@solana-program\/|@stripe\/|@coinbase\/wallet-sdk|@walletconnect\/|@farcaster\/)/;

const shimMissing = {
  name: 'shim-optional',
  setup(b) {
    b.onResolve({ filter: /^@/ }, args => {
      if (OPTIONAL.test(args.path)) return { path: args.path, namespace: 'shim' };
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
