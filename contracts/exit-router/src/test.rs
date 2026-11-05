extern crate std;

use super::{Error, ExitRouter, ExitRouterClient, Swap};
use soroban_sdk::testutils::{Address as _, AuthorizedFunction, Events as _, MuxedAddress as _};
use std::string::ToString;
use soroban_sdk::xdr::{self, ContractEventBody, ScAddress, ScVal};
use soroban_sdk::TryFromVal;
use std::rc::Rc;
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, vec, Address, Env, MuxedAddress, Symbol, Vec};

/// A DeFindex-shaped vault at a 1:1 share price: withdraw burns shares and pays the same amount of its asset, at least `min`.
#[contract]
struct MockVault;

#[contracttype]
enum Key {
    Asset,
    Shares(Address),
}

#[contractimpl]
impl MockVault {
    pub fn init(env: Env, asset: Address) {
        env.storage().instance().set(&Key::Asset, &asset);
    }
    pub fn set_shares(env: Env, owner: Address, shares: i128) {
        env.storage().persistent().set(&Key::Shares(owner), &shares);
    }
    pub fn shares(env: Env, owner: Address) -> i128 {
        env.storage().persistent().get(&Key::Shares(owner)).unwrap_or(0)
    }
    pub fn withdraw(env: Env, withdraw_shares: i128, min_amounts_out: Vec<i128>, from: Address) -> Vec<i128> {
        from.require_auth();
        let held = Self::shares(env.clone(), from.clone());
        assert!(withdraw_shares <= held, "not enough shares");
        assert!(withdraw_shares >= min_amounts_out.get(0).unwrap(), "below min_amounts_out");
        env.storage().persistent().set(&Key::Shares(from.clone()), &(held - withdraw_shares));
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        token::Client::new(&env, &asset).transfer(&env.current_contract_address(), &from, &withdraw_shares);
        vec![&env, withdraw_shares]
    }
}

/// A Soroswap-shaped router at a fixed price of `price` input units per output unit: `swap_tokens_for_exact_tokens` takes the
/// input from `to` (who must authorize it) and pays exactly `amount_out` of the path's last token, refusing above
/// `amount_in_max` or past `deadline`.
#[contract]
struct MockSoroswap;

#[contracttype]
enum SwapKey {
    Price,
}

#[contractimpl]
impl MockSoroswap {
    pub fn init(env: Env, price: i128) {
        env.storage().instance().set(&SwapKey::Price, &price);
    }
    pub fn swap_tokens_for_exact_tokens(
        env: Env,
        amount_out: i128,
        amount_in_max: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Vec<i128> {
        to.require_auth();
        assert!(env.ledger().timestamp() <= deadline, "deadline passed");
        let price: i128 = env.storage().instance().get(&SwapKey::Price).unwrap();
        let amount_in = amount_out * price;
        assert!(amount_in <= amount_in_max, "excessive input amount");
        let here = env.current_contract_address();
        token::Client::new(&env, &path.get(0).unwrap()).transfer(&to, &here, &amount_in);
        token::Client::new(&env, &path.get(path.len() - 1).unwrap()).transfer(&here, &to, &amount_out);
        vec![&env, amount_in, amount_out]
    }
}

/// Creates a classic account entry for `address` in the test ledger (the SDK does the same for a SAC's issuer).
fn create_account(env: &Env, address: &Address) {
    let ScVal::Address(ScAddress::Account(account_id)) = ScVal::try_from_val(env, address.as_val()).unwrap() else {
        panic!("not an account address")
    };
    let key = Rc::new(xdr::LedgerKey::Account(xdr::LedgerKeyAccount { account_id: account_id.clone() }));
    let entry = Rc::new(xdr::LedgerEntry {
        data: xdr::LedgerEntryData::Account(xdr::AccountEntry {
            account_id,
            balance: 100_0000000,
            flags: 0,
            home_domain: Default::default(),
            inflation_dest: None,
            num_sub_entries: 0,
            seq_num: xdr::SequenceNumber(0),
            thresholds: xdr::Thresholds([1; 4]),
            signers: xdr::VecM::default(),
            ext: xdr::AccountEntryExt::V0,
        }),
        last_modified_ledger_seq: 0,
        ext: xdr::LedgerEntryExt::V0,
    });
    env.host().add_ledger_entry(&key, &entry, None).unwrap();
}

struct World {
    env: Env,
    router: ExitRouterClient<'static>,
    usdc: token::Client<'static>,
    vault: MockVaultClient<'static>,
    xlm: token::Client<'static>,
    soroswap: Address,
    user: Address,
    treasury: Address,
    deposit: MuxedAddress,
}

/// A user with 100 USDC of vault shares and 5 USDC in hand; the payment's deposit address is the treasury muxed with id 1002.
fn world() -> World {
    let env = Env::default();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let usdc = token::Client::new(&env, &sac.address());
    let admin = token::StellarAssetClient::new(&env, &sac.address());
    let vault = MockVaultClient::new(&env, &env.register(MockVault, ()));
    vault.init(&sac.address());
    let user = Address::generate(&env);
    // The treasury is an account (G…), as on the network: only accounts can be muxed.
    let deposit = MuxedAddress::new(MuxedAddress::generate(&env), 1002);
    let treasury = deposit.address();
    env.mock_all_auths();
    admin.mint(&vault.address, &100_0000000);
    admin.mint(&user, &5_0000000);
    create_account(&env, &treasury);
    admin.trust(&treasury); // the treasury holds a trustline to the asset, as on testnet
    vault.set_shares(&user, &100_0000000);
    // XLM (another SAC here) and a pool paying 1 USDC for 4 XLM, holding 1,000 USDC; the user holds 400 XLM.
    let xlm_sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let xlm = token::Client::new(&env, &xlm_sac.address());
    let soroswap = env.register(MockSoroswap, ());
    MockSoroswapClient::new(&env, &soroswap).init(&4);
    admin.mint(&soroswap, &1000_0000000);
    token::StellarAssetClient::new(&env, &xlm_sac.address()).mint(&user, &400_0000000);
    let router = ExitRouterClient::new(&env, &env.register(ExitRouter, ()));
    World { env, router, usdc, vault, xlm, soroswap, user, treasury, deposit }
}

/// The `to_muxed_id` the last transfer event carried, as the SAC emits it (CAP-67). Read it right after the call: the test
/// environment keeps only the latest top-level invocation's events.
fn last_transfer_muxed_id(w: &World) -> Option<u64> {
    let events = w.env.events().all().filter_by_contract(&w.usdc.address);
    let event = events.events().last()?.clone();
    let ContractEventBody::V0(body) = event.body;
    let ScVal::Map(Some(map)) = body.data else { return None };
    map.iter().find_map(|entry| match (&entry.key, &entry.val) {
        (ScVal::Symbol(k), ScVal::U64(id)) if k.to_string() == "to_muxed_id" => Some(*id),
        _ => None,
    })
}

#[test]
fn withdraws_from_the_vault_and_pays_the_exact_amount_to_the_muxed_address() {
    let w = world();
    w.router.pay(&w.user, &Some(w.vault.address.clone()), &12_0000000, &12_0000000, &None, &w.usdc.address, &15_0000000, &w.deposit);
    assert_eq!(last_transfer_muxed_id(&w), Some(1002));
    assert_eq!(w.usdc.balance(&w.treasury), 15_0000000);
    assert_eq!(w.usdc.balance(&w.user), 2_0000000); // 5 in hand + 12 withdrawn − 15 paid
    assert_eq!(w.vault.shares(&w.user), 88_0000000);
}

fn swap(w: &World, amount_out: i128, amount_in_max: i128) -> Option<Swap> {
    Some(Swap {
        router: w.soroswap.clone(),
        path: vec![&w.env, w.xlm.address.clone(), w.usdc.address.clone()],
        amount_out,
        amount_in_max,
        deadline: w.env.ledger().timestamp() + 300,
    })
}

#[test]
fn withdraws_swaps_xlm_and_pays_in_one_call() {
    let w = world();
    // 20 to pay: 12 from the vault, 5 in hand, 3 bought with XLM on the AMM (12 XLM at 4:1, at most 13).
    w.router.pay(&w.user, &Some(w.vault.address.clone()), &12_0000000, &12_0000000, &swap(&w, 3_0000000, 13_0000000), &w.usdc.address, &20_0000000, &w.deposit);
    assert_eq!(last_transfer_muxed_id(&w), Some(1002));
    assert_eq!(w.usdc.balance(&w.treasury), 20_0000000);
    assert_eq!(w.usdc.balance(&w.user), 0);
    assert_eq!(w.xlm.balance(&w.user), 388_0000000);
    assert_eq!(w.vault.shares(&w.user), 88_0000000);
}

#[test]
fn one_authorization_covers_withdraw_swap_and_transfer() {
    let w = world();
    w.router.pay(&w.user, &Some(w.vault.address.clone()), &12_0000000, &12_0000000, &swap(&w, 3_0000000, 12_0000000), &w.usdc.address, &20_0000000, &w.deposit);
    let auths = w.env.auths();
    assert_eq!(auths.len(), 1, "exactly one authorization, by the payer");
    let nested: std::vec::Vec<Symbol> = auths[0]
        .1
        .sub_invocations
        .iter()
        .map(|s| match &s.function {
            AuthorizedFunction::Contract((_, name, _)) => name.clone(),
            _ => panic!("unexpected nested authorization"),
        })
        .collect();
    assert_eq!(
        nested,
        std::vec![Symbol::new(&w.env, "withdraw"), Symbol::new(&w.env, "swap_tokens_for_exact_tokens"), symbol_short!("transfer")]
    );
}

#[test]
fn a_swap_above_its_limit_undoes_everything() {
    let w = world();
    // 3 USDC costs 12 XLM; allowing only 11 fails the swap, and the withdraw before it is undone.
    let r = w.router.try_pay(&w.user, &Some(w.vault.address.clone()), &12_0000000, &12_0000000, &swap(&w, 3_0000000, 11_0000000), &w.usdc.address, &20_0000000, &w.deposit);
    assert!(r.is_err());
    assert_eq!(w.vault.shares(&w.user), 100_0000000);
    assert_eq!(w.xlm.balance(&w.user), 400_0000000);
    assert_eq!(w.usdc.balance(&w.treasury), 0);
}

#[test]
fn refuses_a_swap_that_does_not_end_in_the_payment_token() {
    let w = world();
    let mut bad = swap(&w, 3_0000000, 13_0000000).unwrap();
    bad.path = vec![&w.env, w.usdc.address.clone(), w.xlm.address.clone()];
    let r = w.router.try_pay(&w.user, &None, &0, &0, &Some(bad), &w.usdc.address, &3_0000000, &w.deposit);
    assert_eq!(r, Err(Ok(Error::InvalidSwap)));
    let r = w.router.try_pay(&w.user, &None, &0, &0, &swap(&w, 0, 13_0000000), &w.usdc.address, &3_0000000, &w.deposit);
    assert_eq!(r, Err(Ok(Error::InvalidSwap)));
}

#[test]
fn pays_from_the_balance_alone_without_a_vault() {
    let w = world();
    w.router.pay(&w.user, &None, &0, &0, &None, &w.usdc.address, &5_0000000, &w.deposit);
    assert_eq!(last_transfer_muxed_id(&w), Some(1002));
    assert_eq!(w.usdc.balance(&w.treasury), 5_0000000);
}

#[test]
fn one_authorization_by_the_payer_covers_the_withdraw_and_the_transfer() {
    let w = world();
    w.router.pay(&w.user, &Some(w.vault.address.clone()), &10_0000000, &10_0000000, &None, &w.usdc.address, &10_0000000, &w.deposit);
    let auths = w.env.auths();
    assert_eq!(auths.len(), 1, "exactly one authorization, by the payer");
    let (who, root) = &auths[0];
    assert_eq!(who, &w.user);
    match &root.function {
        AuthorizedFunction::Contract((contract, name, _)) => {
            assert_eq!(contract, &w.router.address);
            assert_eq!(name, &Symbol::new(&w.env, "pay"));
        }
        _ => panic!("the root is the router call"),
    }
    let nested: std::vec::Vec<Symbol> = root
        .sub_invocations
        .iter()
        .map(|s| match &s.function {
            AuthorizedFunction::Contract((_, name, _)) => name.clone(),
            _ => panic!("unexpected nested authorization"),
        })
        .collect();
    assert_eq!(nested, std::vec![Symbol::new(&w.env, "withdraw"), symbol_short!("transfer")]);
}

#[test]
fn is_atomic_a_failing_transfer_undoes_the_withdraw() {
    let w = world();
    // Withdraw 10, but try to pay 20 with only 15 in hand: the transfer fails and nothing moves.
    let r = w.router.try_pay(&w.user, &Some(w.vault.address.clone()), &10_0000000, &10_0000000, &None, &w.usdc.address, &20_0000000, &w.deposit);
    assert!(r.is_err());
    assert_eq!(w.vault.shares(&w.user), 100_0000000);
    assert_eq!(w.usdc.balance(&w.user), 5_0000000);
    assert_eq!(w.usdc.balance(&w.treasury), 0);
}

#[test]
fn refuses_without_the_payers_authorization() {
    let w = world();
    w.env.set_auths(&[]); // nobody signed
    let r = w.router.try_pay(&w.user, &None, &0, &0, &None, &w.usdc.address, &1_0000000, &w.deposit);
    assert!(r.is_err());
    assert_eq!(w.usdc.balance(&w.treasury), 0);
}

#[test]
fn refuses_non_positive_amounts_and_bad_withdraws() {
    let w = world();
    let pay = |shares: i128, min: i128, amount: i128| {
        w.router.try_pay(&w.user, &Some(w.vault.address.clone()), &shares, &min, &None, &w.usdc.address, &amount, &w.deposit)
    };
    assert_eq!(pay(1, 1, 0), Err(Ok(Error::NonPositiveAmount)));
    assert_eq!(pay(0, 0, 1), Err(Ok(Error::InvalidWithdraw)));
    assert_eq!(pay(1, -1, 1), Err(Ok(Error::InvalidWithdraw)));
}
