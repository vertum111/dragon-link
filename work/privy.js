// Email / Google sign-in with Privy, loaded only when a player asks for it (the guest game never downloads it).
// Privy gives each player an embedded NEAR wallet and signs silently: no seed phrase, no wallet pop-up.
// The wallet's key becomes the access key of the player's game account (name-xxxx.dragonlink.testnet), and the game
// server relays the player's signed meta-transactions, so gas is never the player's problem.
// Same pattern as near-examples/hello-privy (and our Lunearcy), without JSX.
import { createElement as h, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useLogin, useLogout } from '@privy-io/react-auth';
import { useCreateWallet, useSignRawHash } from '@privy-io/react-auth/extended-chains';
import { Signer, PublicKey } from 'near-api-js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/** A near-api-js signer backed by Privy's embedded wallet. Its address is the ed25519 public key in hex. */
class PrivySigner extends Signer {
  constructor(signRawHash, address) { super(); this.signRawHash = signRawHash; this.address = address; }
  async getPublicKey() { return new PublicKey({ keyType: 0, data: hexToBytes(this.address) }); }
  async signBytes(bytes) {
    const { signature } = await this.signRawHash({ address: this.address, chainType: 'near', hash: `0x${bytesToHex(bytes)}` });
    return hexToBytes(signature.replace(/^0x/, ''));
  }
}

const nameOf = user => user.google?.name?.split(' ')[0] || user.email?.address?.split('@')[0] || user.google?.email?.split('@')[0] || 'Player';

/** Mounts Privy once. `onIdentity({signer, publicKey, name, email})` fires after sign-in and on a restored session;
 *  `onLogout()` after sign-out. Returns {login, logout}. */
export function startPrivy({ appId, onIdentity, onLogout, onError }) {
  const holder = document.createElement('div'); holder.id = 'privy-root'; document.body.append(holder);
  const api = { login: () => {}, logout: async () => {}, ready: false };
  function Bridge() {
    const { ready, authenticated, user } = usePrivy();
    const { login } = useLogin({ onError: e => onError?.(e) });
    const { logout } = useLogout();
    const { createWallet } = useCreateWallet();
    const { signRawHash } = useSignRawHash();
    const creating = useRef(false), reported = useRef('');
    api.ready = ready;
    api.login = opts => login(opts);
    api.logout = async () => { await logout(); reported.current = ''; onLogout?.(); };
    useEffect(() => {
      if (!ready || !authenticated || !user) return;
      const wallet = user.linkedAccounts.find(a => a.type === 'wallet' && a.chainType === 'near');
      if (!wallet) {
        if (!creating.current) { creating.current = true; createWallet({ chainType: 'near' }).catch(e => onError?.(e)).finally(() => { creating.current = false; }); }
        return;
      }
      if (reported.current === wallet.address) return;
      reported.current = wallet.address;
      const signer = new PrivySigner(signRawHash, wallet.address);
      signer.getPublicKey().then(pk => onIdentity?.({ signer, publicKey: pk.toString(), name: nameOf(user), email: user.email?.address || user.google?.email || '' }));
    }, [ready, authenticated, user, createWallet, signRawHash]);
    return null;
  }
  createRoot(holder).render(h(PrivyProvider, {
    appId,
    config: {
      loginMethods: ['email', 'google'],
      appearance: { theme: 'light', accentColor: '#ff3f8e', landingHeader: 'Dragon Link', loginMessage: 'Keep your dragon and its items on any device.' },
      embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } },
    },
  }, h(Bridge)));
  return api;
}
