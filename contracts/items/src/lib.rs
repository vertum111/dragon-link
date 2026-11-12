//! Dragon Link items — one NEP-245 multi-token contract for every good on 商店街.
//!
//! Token ids: `scales` (the currency), `ore`, `fish`, `shard`, `moss`, `grilled`, `tea`, `pearl`, `rice`.
//!
//! Who can do what:
//! - players move their own tokens (`mt_transfer`, `mt_batch_transfer`), eat or use them (`consume`),
//!   and accept a merchant's signed price (`trade`). Their transactions are relayed, so they pay no gas;
//! - merchant agents never sign transactions that touch player balances. They sign *quotes* off-chain;
//!   the contract checks the signature against the merchant's registered key before swapping;
//! - the operator (the game server) mints rewards (walk finds, game scores, battle loot) and keeps the
//!   merchants' stock in step with the off-chain market (`set_merchant_stock`). It cannot take from players.
//!
//! Not implemented yet: `mt_transfer_call` / approvals (no other contract needs to receive items today).

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, log, near, AccountId, NearToken, PanicOnDefault};

/// Like `require!`, but keeps the reason in release builds (near-sdk's `require!` drops it to save bytes),
/// so players and judges see why a call failed.
fn check(ok: bool, reason: &str) {
    if !ok {
        env::panic_str(reason)
    }
}

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct Quote {
    pub merchant: AccountId,
    pub player: AccountId,
    /// what the player hands over (e.g. `scales` when buying, a material when selling)
    pub give_token: String,
    pub give_amount: U128,
    /// what the player receives
    pub take_token: String,
    pub take_amount: U128,
    pub nonce: u64,
    pub expires_at_ms: u64,
}

impl Quote {
    /// The exact bytes a merchant signs. Kept as a plain string so any server can rebuild it.
    pub fn message(&self) -> String {
        format!(
            "dragonlink-quote:v1:{}:{}:{}:{}:{}:{}:{}:{}",
            self.merchant, self.player, self.give_token, self.give_amount.0, self.take_token, self.take_amount.0,
            self.nonce, self.expires_at_ms
        )
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Items {
    owner: AccountId,
    operator: AccountId,
    /// key: "<token>\u{0}<account>"
    balances: LookupMap<String, u128>,
    supply: LookupMap<String, u128>,
    /// merchant account → 32-byte ed25519 public key used to sign quotes
    merchants: LookupMap<AccountId, Vec<u8>>,
    /// "<merchant>:<nonce>" of every quote already used
    used: LookupSet<String>,
    /// open player-to-player trade offers (LINK → TRADE); the offered items wait in escrow
    offers: LookupMap<u64, Offer>,
    /// account → ids of the open offers it made or received
    inbox: LookupMap<AccountId, Vec<u64>>,
    next_offer: u64,
}

/// A LINK trade: `from` puts `give` in escrow and asks `to` for `want`. Accepting swaps both at once.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Offer {
    pub id: u64,
    pub from: AccountId,
    pub to: AccountId,
    pub give: Vec<(String, U128)>,
    pub want: Vec<(String, U128)>,
    pub expires_at_ms: u64,
}

/// The state before trade offers existed, read once by `migrate`.
#[near(serializers = [borsh])]
struct ItemsV1 {
    owner: AccountId,
    operator: AccountId,
    balances: LookupMap<String, u128>,
    supply: LookupMap<String, u128>,
    merchants: LookupMap<AccountId, Vec<u8>>,
    used: LookupSet<String>,
}

fn key(token: &str, account: &AccountId) -> String {
    format!("{token}\u{0}{account}")
}

fn emit(event: &str, data: String) {
    log!(r#"EVENT_JSON:{{"standard":"nep245","version":"1.0.0","event":"{}","data":[{}]}}"#, event, data);
}

fn list(xs: &[String]) -> String {
    xs.iter().map(|x| format!("\"{x}\"")).collect::<Vec<_>>().join(",")
}

#[near]
impl Items {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId) -> Self {
        Self {
            owner: owner_id,
            operator: operator_id,
            balances: LookupMap::new(b"b"),
            supply: LookupMap::new(b"s"),
            merchants: LookupMap::new(b"m"),
            used: LookupSet::new(b"u"),
            offers: LookupMap::new(b"o"),
            inbox: LookupMap::new(b"i"),
            next_offer: 1,
        }
    }

    /// One-off upgrade from the first deployment: keeps every balance, adds the offer book.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: ItemsV1 = env::state_read().unwrap_or_else(|| env::panic_str("no state to migrate"));
        Self {
            owner: old.owner, operator: old.operator, balances: old.balances, supply: old.supply,
            merchants: old.merchants, used: old.used,
            offers: LookupMap::new(b"o"), inbox: LookupMap::new(b"i"), next_offer: 1,
        }
    }

    // ───────────────────────── views ─────────────────────────
    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.balances.get(&key(&token_id, &account_id)).copied().unwrap_or(0))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.into_iter().map(|t| self.mt_balance_of(account_id.clone(), t)).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        self.supply.get(&token_id).map(|s| U128(*s))
    }

    pub fn is_merchant(&self, account_id: AccountId) -> bool {
        self.merchants.contains_key(&account_id)
    }

    pub fn quote_used(&self, merchant: AccountId, nonce: u64) -> bool {
        self.used.contains(&format!("{merchant}:{nonce}"))
    }

    // ───────────────────────── NEP-245 transfers ─────────────────────────
    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        check(approval.is_none(), "approvals are not supported");
        let sender = env::predecessor_account_id();
        self.move_tokens(&sender, &receiver_id, &[token_id], &[amount.0], memo);
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        check(approvals.map_or(true, |a| a.iter().all(|x| x.is_none())), "approvals are not supported");
        check(token_ids.len() == amounts.len(), "token_ids and amounts differ in length");
        let sender = env::predecessor_account_id();
        let amounts: Vec<u128> = amounts.iter().map(|a| a.0).collect();
        self.move_tokens(&sender, &receiver_id, &token_ids, &amounts, memo);
    }

    // ───────────────────────── players ─────────────────────────
    /// The dragon eats a Grilled Fish, drinks tea, or swallows a Dragon Pearl: the item is burned.
    pub fn consume(&mut self, token_id: String, amount: U128) {
        let who = env::predecessor_account_id();
        self.burn(&who, &token_id, amount.0, Some("consumed".into()));
    }

    /// Accept a merchant's signed quote. Both sides move in one call, or nothing moves.
    pub fn trade(&mut self, quote: Quote, signature: Base64VecU8) {
        check(env::predecessor_account_id() == quote.player, "only the quoted player can accept this quote");
        check(env::block_timestamp_ms() <= quote.expires_at_ms, "quote expired");
        let pk = self.merchants.get(&quote.merchant).unwrap_or_else(|| env::panic_str("unknown merchant")).clone();
        let sig: [u8; 64] = signature.0.as_slice().try_into().unwrap_or_else(|_| env::panic_str("bad signature length"));
        let pk: [u8; 32] = pk.as_slice().try_into().unwrap_or_else(|_| env::panic_str("bad merchant key"));
        check(env::ed25519_verify(&sig, quote.message().as_bytes(), &pk), "merchant signature does not match");
        let tag = format!("{}:{}", quote.merchant, quote.nonce);
        check(self.used.insert(tag), "quote already used");
        let memo = Some(format!("trade #{}", quote.nonce));
        self.move_tokens(&quote.player, &quote.merchant, &[quote.give_token.clone()], &[quote.give_amount.0], memo.clone());
        self.move_tokens(&quote.merchant, &quote.player, &[quote.take_token.clone()], &[quote.take_amount.0], memo);
    }

    // ───────────────────────── LINK trades between players ─────────────────────────
    /// Put up to three kinds of items in escrow and ask `to` for up to three kinds back.
    pub fn offer_create(&mut self, to: AccountId, give: Vec<(String, U128)>, want: Vec<(String, U128)>, expires_in_ms: Option<u64>) -> u64 {
        let from = env::predecessor_account_id();
        check(from != to, "you cannot trade with yourself");
        check(!give.is_empty() && give.len() <= 3 && want.len() <= 3, "offer 1 to 3 kinds of items and ask for at most 3");
        check(give.iter().chain(want.iter()).all(|(_, a)| a.0 > 0), "amounts must be positive");
        let id = self.next_offer;
        self.next_offer += 1;
        let escrow = env::current_account_id();
        let (tokens, amounts): (Vec<String>, Vec<u128>) = give.iter().map(|(t, a)| (t.clone(), a.0)).unzip();
        self.move_tokens(&from, &escrow, &tokens, &amounts, Some(format!("offer #{id} escrow")));
        let offer = Offer { id, from: from.clone(), to: to.clone(), give, want,
            expires_at_ms: env::block_timestamp_ms() + expires_in_ms.unwrap_or(600_000).min(86_400_000) };
        self.offers.insert(id, offer);
        for who in [from, to] {
            let mut ids = self.inbox.get(&who).cloned().unwrap_or_default();
            ids.push(id);
            self.inbox.insert(who, ids);
        }
        log!(r#"EVENT_JSON:{{"standard":"dragonlink","version":"1.0.0","event":"offer_created","data":[{{"id":{}}}]}}"#, id);
        id
    }

    /// The receiver accepts: their `want` goes to the offerer and the escrowed `give` comes to them, in one call.
    pub fn offer_accept(&mut self, id: u64) {
        let offer = self.offers.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such offer"));
        check(env::predecessor_account_id() == offer.to, "this offer is for someone else");
        check(env::block_timestamp_ms() <= offer.expires_at_ms, "offer expired");
        let escrow = env::current_account_id();
        let memo = Some(format!("offer #{id} accepted"));
        if !offer.want.is_empty() {
            let (tokens, amounts): (Vec<String>, Vec<u128>) = offer.want.iter().map(|(t, a)| (t.clone(), a.0)).unzip();
            self.move_tokens(&offer.to, &offer.from, &tokens, &amounts, memo.clone());
        }
        let (tokens, amounts): (Vec<String>, Vec<u128>) = offer.give.iter().map(|(t, a)| (t.clone(), a.0)).unzip();
        self.move_tokens(&escrow, &offer.to, &tokens, &amounts, memo);
        self.close_offer(&offer, "offer_accepted");
    }

    /// The offerer withdraws, the receiver declines, or anyone tidies up an expired offer: escrow goes back.
    pub fn offer_cancel(&mut self, id: u64) {
        let offer = self.offers.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such offer"));
        let who = env::predecessor_account_id();
        check(who == offer.from || who == offer.to || env::block_timestamp_ms() > offer.expires_at_ms, "only the two traders can cancel an open offer");
        let (tokens, amounts): (Vec<String>, Vec<u128>) = offer.give.iter().map(|(t, a)| (t.clone(), a.0)).unzip();
        self.move_tokens(&env::current_account_id(), &offer.from, &tokens, &amounts, Some(format!("offer #{id} returned")));
        self.close_offer(&offer, if who == offer.to { "offer_declined" } else { "offer_cancelled" });
    }

    pub fn offer(&self, id: u64) -> Option<Offer> {
        self.offers.get(&id).cloned()
    }

    pub fn offers_for(&self, account_id: AccountId) -> Vec<Offer> {
        self.inbox.get(&account_id).map(|ids| ids.iter().filter_map(|i| self.offers.get(i).cloned()).collect()).unwrap_or_default()
    }

    // ───────────────────────── operator (game server) ─────────────────────────
    /// Rewards: walk finds, mini-game scores, battle loot, the starter kit.
    pub fn mint(&mut self, owner_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, memo: Option<String>) {
        self.only_operator();
        check(token_ids.len() == amounts.len(), "token_ids and amounts differ in length");
        for (t, a) in token_ids.iter().zip(amounts.iter()) {
            let k = key(t, &owner_id);
            let bal = self.balances.get(&k).copied().unwrap_or(0);
            self.balances.insert(k, bal + a.0);
            let s = self.supply.get(t).copied().unwrap_or(0);
            self.supply.insert(t.clone(), s + a.0);
        }
        let amounts: Vec<String> = amounts.iter().map(|a| a.0.to_string()).collect();
        let memo = memo.map(|m| format!(",\"memo\":\"{}\"", m.replace('"', "'"))).unwrap_or_default();
        emit("mt_mint", format!(r#"{{"owner_id":"{}","token_ids":[{}],"amounts":[{}]{}}}"#, owner_id, list(&token_ids), list(&amounts), memo));
    }

    /// Merchants' stock lives in the off-chain market; this keeps their on-chain balance equal to it.
    /// Only works on registered merchant accounts, never on players.
    pub fn set_merchant_stock(&mut self, merchant_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>) {
        self.only_operator();
        check(self.merchants.contains_key(&merchant_id), "not a merchant");
        check(token_ids.len() == amounts.len(), "token_ids and amounts differ in length");
        for (t, a) in token_ids.iter().zip(amounts.iter()) {
            let have = self.mt_balance_of(merchant_id.clone(), t.clone()).0;
            if a.0 > have {
                self.mint(merchant_id.clone(), vec![t.clone()], vec![U128(a.0 - have)], Some("market sync".into()));
            } else if a.0 < have {
                self.burn(&merchant_id, t, have - a.0, Some("market sync".into()));
            }
        }
    }

    // ───────────────────────── owner ─────────────────────────
    /// `public_key`: the merchant agent's 32-byte ed25519 key, base64.
    pub fn register_merchant(&mut self, merchant_id: AccountId, public_key: Base64VecU8) {
        check(env::predecessor_account_id() == self.owner, "only the owner");
        check(public_key.0.len() == 32, "expected a 32-byte ed25519 key");
        self.merchants.insert(merchant_id, public_key.0);
    }

    pub fn set_operator(&mut self, operator_id: AccountId) {
        check(env::predecessor_account_id() == self.owner, "only the owner");
        self.operator = operator_id;
    }

    // ───────────────────────── internals ─────────────────────────
    fn close_offer(&mut self, offer: &Offer, event: &str) {
        self.offers.remove(&offer.id);
        for who in [&offer.from, &offer.to] {
            if let Some(ids) = self.inbox.get(who).cloned() {
                let left: Vec<u64> = ids.into_iter().filter(|i| *i != offer.id).collect();
                if left.is_empty() { self.inbox.remove(who); } else { self.inbox.insert(who.clone(), left); }
            }
        }
        log!(r#"EVENT_JSON:{{"standard":"dragonlink","version":"1.0.0","event":"{}","data":[{{"id":{}}}]}}"#, event, offer.id);
    }

    fn only_operator(&self) {
        check(env::predecessor_account_id() == self.operator, "only the game operator");
    }

    fn move_tokens(&mut self, from: &AccountId, to: &AccountId, tokens: &[String], amounts: &[u128], memo: Option<String>) {
        check(from != to, "sender and receiver are the same");
        for (t, a) in tokens.iter().zip(amounts.iter()) {
            check(*a > 0, "amount must be positive");
            let fk = key(t, from);
            let have = self.balances.get(&fk).copied().unwrap_or(0);
            check(have >= *a, &format!("not enough {t}"));
            self.balances.insert(fk, have - a);
            let tk = key(t, to);
            let got = self.balances.get(&tk).copied().unwrap_or(0);
            self.balances.insert(tk, got + a);
        }
        let amounts: Vec<String> = amounts.iter().map(|a| a.to_string()).collect();
        let memo = memo.map(|m| format!(",\"memo\":\"{}\"", m.replace('"', "'"))).unwrap_or_default();
        emit("mt_transfer", format!(r#"{{"old_owner_id":"{}","new_owner_id":"{}","token_ids":[{}],"amounts":[{}]{}}}"#, from, to, list(tokens), list(&amounts), memo));
    }

    fn burn(&mut self, owner: &AccountId, token: &str, amount: u128, memo: Option<String>) {
        check(amount > 0, "amount must be positive");
        let k = key(token, owner);
        let have = self.balances.get(&k).copied().unwrap_or(0);
        check(have >= amount, &format!("not enough {token}"));
        self.balances.insert(k, have - amount);
        let s = self.supply.get(token).copied().unwrap_or(0);
        self.supply.insert(token.to_string(), s.saturating_sub(amount));
        let memo = memo.map(|m| format!(",\"memo\":\"{}\"", m.replace('"', "'"))).unwrap_or_default();
        emit("mt_burn", format!(r#"{{"owner_id":"{}","token_ids":["{}"],"amounts":["{}"]{}}}"#, owner, token, amount, memo));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(who: AccountId, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(who).attached_deposit(NearToken::from_yoctonear(deposit)).block_timestamp(1_000_000_000_000);
        testing_env!(b.build());
    }

    fn setup() -> (Items, SigningKey) {
        ctx(accounts(0), 0);
        let mut c = Items::new(accounts(0), accounts(1));
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        c.register_merchant(accounts(2), Base64VecU8(sk.verifying_key().to_bytes().to_vec()));
        ctx(accounts(1), 0);
        c.mint(accounts(3), vec!["scales".into(), "grilled".into()], vec![U128(20), U128(5)], Some("starter kit".into()));
        c.set_merchant_stock(accounts(2), vec!["grilled".into(), "fish".into()], vec![U128(8), U128(4)]);
        (c, sk)
    }

    fn quote(nonce: u64) -> Quote {
        Quote { merchant: accounts(2), player: accounts(3), give_token: "scales".into(), give_amount: U128(13),
                take_token: "grilled".into(), take_amount: U128(1), nonce, expires_at_ms: 2_000_000 }
    }

    #[test]
    fn signed_trade_swaps_both_sides() {
        let (mut c, sk) = setup();
        let q = quote(1);
        let sig = sk.sign(q.message().as_bytes()).to_bytes().to_vec();
        ctx(accounts(3), 0);
        c.trade(q, Base64VecU8(sig));
        assert_eq!(c.mt_balance_of(accounts(3), "scales".into()).0, 7);
        assert_eq!(c.mt_balance_of(accounts(3), "grilled".into()).0, 6);
        assert_eq!(c.mt_balance_of(accounts(2), "scales".into()).0, 13);
        assert_eq!(c.mt_balance_of(accounts(2), "grilled".into()).0, 7);
        assert!(c.quote_used(accounts(2), 1));
    }

    #[test]
    #[should_panic(expected = "quote already used")]
    fn a_quote_works_once() {
        let (mut c, sk) = setup();
        let q = quote(2);
        let sig = sk.sign(q.message().as_bytes()).to_bytes().to_vec();
        ctx(accounts(3), 0);
        c.trade(q.clone(), Base64VecU8(sig.clone()));
        c.trade(q, Base64VecU8(sig));
    }

    #[test]
    #[should_panic(expected = "merchant signature does not match")]
    fn a_player_cannot_change_the_price() {
        let (mut c, sk) = setup();
        let q = quote(3);
        let sig = sk.sign(q.message().as_bytes()).to_bytes().to_vec();
        let mut cheaper = q;
        cheaper.give_amount = U128(1);
        ctx(accounts(3), 0);
        c.trade(cheaper, Base64VecU8(sig));
    }

    #[test]
    #[should_panic(expected = "only the quoted player")]
    fn someone_else_cannot_use_my_quote() {
        let (mut c, sk) = setup();
        let q = quote(4);
        let sig = sk.sign(q.message().as_bytes()).to_bytes().to_vec();
        ctx(accounts(4), 0);
        c.trade(q, Base64VecU8(sig));
    }

    #[test]
    #[should_panic(expected = "quote expired")]
    fn expired_quotes_fail() {
        let (mut c, sk) = setup();
        let mut q = quote(5);
        q.expires_at_ms = 10;
        let sig = sk.sign(q.message().as_bytes()).to_bytes().to_vec();
        ctx(accounts(3), 0);
        c.trade(q, Base64VecU8(sig));
    }

    #[test]
    fn eating_burns_the_item_and_transfers_need_one_yocto() {
        let (mut c, _) = setup();
        ctx(accounts(3), 0);
        c.consume("grilled".into(), U128(1));
        assert_eq!(c.mt_balance_of(accounts(3), "grilled".into()).0, 4);
        assert_eq!(c.mt_supply("grilled".into()).unwrap().0, 4 + 8);
        ctx(accounts(3), 1);
        c.mt_transfer(accounts(4), "grilled".into(), U128(2), None, None);
        assert_eq!(c.mt_balance_of(accounts(4), "grilled".into()).0, 2);
    }

    fn trade_setup() -> Items {
        let (mut c, _) = setup();
        ctx(accounts(1), 0);
        c.mint(accounts(4), vec!["fish".into()], vec![U128(3)], None);
        c.mint(accounts(3), vec!["ore".into()], vec![U128(2)], None);
        c
    }

    #[test]
    fn link_trade_swaps_through_escrow() {
        let mut c = trade_setup();
        ctx(accounts(3), 0);
        let id = c.offer_create(accounts(4), vec![("ore".into(), U128(2))], vec![("fish".into(), U128(1))], None);
        assert_eq!(c.mt_balance_of(accounts(3), "ore".into()).0, 0, "ore waits in escrow");
        assert_eq!(c.offers_for(accounts(4)).len(), 1);
        ctx(accounts(4), 0);
        c.offer_accept(id);
        assert_eq!(c.mt_balance_of(accounts(4), "ore".into()).0, 2);
        assert_eq!(c.mt_balance_of(accounts(3), "fish".into()).0, 1);
        assert_eq!(c.mt_balance_of(accounts(4), "fish".into()).0, 2);
        assert!(c.offer(id).is_none());
        assert!(c.offers_for(accounts(3)).is_empty());
    }

    #[test]
    fn declining_returns_the_escrow() {
        let mut c = trade_setup();
        ctx(accounts(3), 0);
        let id = c.offer_create(accounts(4), vec![("ore".into(), U128(1))], vec![("fish".into(), U128(1))], None);
        ctx(accounts(4), 0);
        c.offer_cancel(id);
        assert_eq!(c.mt_balance_of(accounts(3), "ore".into()).0, 2);
    }

    #[test]
    #[should_panic(expected = "this offer is for someone else")]
    fn only_the_receiver_can_accept() {
        let mut c = trade_setup();
        ctx(accounts(3), 0);
        let id = c.offer_create(accounts(4), vec![("ore".into(), U128(1))], vec![], None);
        ctx(accounts(5), 0);
        c.offer_accept(id);
    }

    #[test]
    #[should_panic(expected = "not enough fish")]
    fn accepting_without_the_goods_fails_and_keeps_the_escrow() {
        let mut c = trade_setup();
        ctx(accounts(3), 0);
        let id = c.offer_create(accounts(4), vec![("ore".into(), U128(1))], vec![("fish".into(), U128(9))], None);
        ctx(accounts(4), 0);
        c.offer_accept(id);
    }

    #[test]
    #[should_panic(expected = "only the game operator")]
    fn players_cannot_mint() {
        let (mut c, _) = setup();
        ctx(accounts(3), 0);
        c.mint(accounts(3), vec!["pearl".into()], vec![U128(1)], None);
    }

    #[test]
    #[should_panic(expected = "not a merchant")]
    fn the_operator_cannot_touch_player_balances() {
        let (mut c, _) = setup();
        ctx(accounts(1), 0);
        c.set_merchant_stock(accounts(3), vec!["scales".into()], vec![U128(0)]);
    }
}
