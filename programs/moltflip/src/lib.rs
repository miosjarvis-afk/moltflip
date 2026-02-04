use anchor_lang::prelude::*;

declare_id!("Mo1tF1ipXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

pub mod state;
pub mod instructions;
pub mod errors;
pub mod vrf;

use instructions::*;

#[program]
pub mod moltflip {
    use super::*;

    /// Initialize the house with treasury and config
    pub fn initialize(
        ctx: Context<Initialize>,
        house_edge_bps: u16,  // Basis points (200 = 2%)
        max_bet_bps: u16,     // Max bet as % of treasury (100 = 1%)
    ) -> Result<()> {
        instructions::initialize::handler(ctx, house_edge_bps, max_bet_bps)
    }

    /// PvE: Agent flips against the house
    pub fn pve_flip(
        ctx: Context<PveFlip>,
        amount: u64,
        choice: bool,  // true = heads, false = tails
    ) -> Result<()> {
        instructions::pve_flip::handler(ctx, amount, choice)
    }

    /// Consume VRF result and settle PvE flip
    pub fn pve_settle(
        ctx: Context<PveSettle>,
    ) -> Result<()> {
        instructions::pve_settle::handler(ctx)
    }

    /// PvP: Create a match and escrow funds
    pub fn pvp_create(
        ctx: Context<PvpCreate>,
        amount: u64,
        choice: bool,
    ) -> Result<()> {
        instructions::pvp_create::handler(ctx, amount, choice)
    }

    /// PvP: Join a match, trigger flip, settle
    pub fn pvp_join(
        ctx: Context<PvpJoin>,
    ) -> Result<()> {
        instructions::pvp_join::handler(ctx)
    }

    /// PvP: Cancel an unmatched game (creator only)
    pub fn pvp_cancel(
        ctx: Context<PvpCancel>,
    ) -> Result<()> {
        instructions::pvp_cancel::handler(ctx)
    }

    /// Withdraw from house treasury (admin only)
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
    ) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    /// Update house config (admin only)
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        house_edge_bps: Option<u16>,
        max_bet_bps: Option<u16>,
        paused: Option<bool>,
    ) -> Result<()> {
        instructions::update_config::handler(ctx, house_edge_bps, max_bet_bps, paused)
    }
}
