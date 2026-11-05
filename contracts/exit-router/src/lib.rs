//! Vants exit router (SPEC §3.5, DEC-031): one Soroban call, so one signature, per payment.
//!
//! `pay` optionally withdraws an exact amount from a DeFindex vault to the payer, optionally buys an exact amount of `token` with
//! XLM on a Soroswap-style AMM for the payer (a Soroban call can't reach the classic order book, and a Soroban transaction holds
//! one operation, so the swap has to happen inside this call to keep one signature: DEC-034), then transfers exactly `amount`
//! of `token` from the payer to the payment's deposit address. That address is a muxed `M…` address (CAP-67), so the transfer event carries
//! `to_muxed_id` and Vants matches the deposit to the payment the same way as any other. The payer authorizes this call; under
//! it, the vault withdraw, the swap and the token transfer (the payer is the transaction source, so the envelope's signature covers all).
//!
//! The router is stateless: no admin, no storage, and it never holds funds. It can only move the caller's own money, with the
//! caller's authorization, and the whole call is atomic.
#![no_std]
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, token, vec, Address, Env, MuxedAddress, Vec,
};

/// The slice of a DeFindex vault the router uses: `withdraw(withdraw_shares, min_amounts_out, from)` pays the underlying to `from`.
#[contractclient(name = "VaultClient")]
pub trait DefindexVault {
    fn withdraw(env: Env, withdraw_shares: i128, min_amounts_out: Vec<i128>, from: Address) -> Vec<i128>;
}

/// The slice of a Soroswap router the exit router uses: buys exactly `amount_out` of the path's last token for `to`, spending at
/// most `amount_in_max` of its first token from `to`, before `deadline` (unix seconds).
#[contractclient(name = "AmmClient")]
pub trait SoroswapRouter {
    fn swap_tokens_for_exact_tokens(
        env: Env,
        amount_out: i128,
        amount_in_max: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Vec<i128>;
}

/// An exact-output swap for the payer: `amount_out` of `path`'s last token (the payment token) for at most `amount_in_max` of
/// its first.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Swap {
    pub router: Address,
    pub path: Vec<Address>,
    pub amount_out: i128,
    pub amount_in_max: i128,
    pub deadline: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The payment amount must be positive.
    NonPositiveAmount = 1,
    /// A vault withdraw must burn a positive number of shares and expect a non-negative amount.
    InvalidWithdraw = 2,
    /// A swap must buy a positive amount of the payment token, along a path of at least two tokens, for a positive limit.
    InvalidSwap = 3,
}

#[contract]
pub struct ExitRouter;

#[contractimpl]
impl ExitRouter {
    /// Withdraws `shares` from `vault` to `from` (receiving at least `min_out`) when a vault is given, buys `swap.amount_out` of
    /// `token` for `from` when a swap is given, then transfers exactly `amount` of `token` from `from` to `to`. Any failure
    /// reverts the whole call.
    #[allow(clippy::too_many_arguments)]
    pub fn pay(
        env: Env,
        from: Address,
        vault: Option<Address>,
        shares: i128,
        min_out: i128,
        swap: Option<Swap>,
        token: Address,
        amount: i128,
        to: MuxedAddress,
    ) -> Result<(), Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::NonPositiveAmount);
        }
        if let Some(vault) = vault {
            if shares <= 0 || min_out < 0 {
                return Err(Error::InvalidWithdraw);
            }
            VaultClient::new(&env, &vault).withdraw(&shares, &vec![&env, min_out], &from);
        }
        if let Some(swap) = swap {
            let ends_in_token = swap.path.len() >= 2 && swap.path.last() == Some(token.clone());
            if !ends_in_token || swap.amount_out <= 0 || swap.amount_in_max <= 0 {
                return Err(Error::InvalidSwap);
            }
            AmmClient::new(&env, &swap.router).swap_tokens_for_exact_tokens(
                &swap.amount_out,
                &swap.amount_in_max,
                &swap.path,
                &from,
                &swap.deadline,
            );
        }
        token::Client::new(&env, &token).transfer(&from, &to, &amount);
        Ok(())
    }
}

#[cfg(test)]
mod test;
