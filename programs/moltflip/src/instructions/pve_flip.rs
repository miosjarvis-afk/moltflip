use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::state::{HouseConfig, PendingFlip};
use crate::errors::MoltflipError;

#[derive(Accounts)]
pub struct PveFlip<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"house"],
        bump = house.bump,
    )]
    pub house: Account<'info, HouseConfig>,

    #[account(
        init,
        payer = player,
        space = PendingFlip::SIZE,
        seeds = [b"pending", player.key().as_ref()],
        bump
    )]
    pub pending_flip: Account<'info, PendingFlip>,

    /// CHECK: VRF account - validated by Switchboard
    pub vrf_request: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<PveFlip>,
    amount: u64,
    choice: bool,
) -> Result<()> {
    let house = &ctx.accounts.house;
    
    // Validations
    require!(!house.paused, MoltflipError::HousePaused);
    require!(amount > 0, MoltflipError::BetTooSmall);
    require!(amount <= house.max_bet(), MoltflipError::BetTooLarge);
    
    // Ensure house can pay potential winnings
    // Win payout = amount * 2 - house_edge
    let potential_payout = amount
        .checked_mul(2)
        .ok_or(MoltflipError::Overflow)?
        .checked_mul(10000 - house.house_edge_bps as u64)
        .ok_or(MoltflipError::Overflow)?
        .checked_div(10000)
        .ok_or(MoltflipError::Overflow)?;
    
    require!(
        house.treasury_balance >= potential_payout.saturating_sub(amount),
        MoltflipError::InsufficientTreasury
    );

    // Transfer bet to house PDA
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.house.to_account_info(),
            },
        ),
        amount,
    )?;

    // Record pending flip
    let pending = &mut ctx.accounts.pending_flip;
    pending.player = ctx.accounts.player.key();
    pending.amount = amount;
    pending.choice = choice;
    pending.vrf_request = ctx.accounts.vrf_request.key();
    pending.created_at = Clock::get()?.unix_timestamp;
    pending.bump = ctx.bumps.pending_flip;

    // Update house stats
    let house = &mut ctx.accounts.house;
    house.treasury_balance = house.treasury_balance.checked_add(amount).ok_or(MoltflipError::Overflow)?;
    house.total_flips = house.total_flips.checked_add(1).ok_or(MoltflipError::Overflow)?;
    house.total_volume = house.total_volume.checked_add(amount).ok_or(MoltflipError::Overflow)?;

    msg!("PvE flip initiated");
    msg!("Player: {}", pending.player);
    msg!("Amount: {} lamports", amount);
    msg!("Choice: {}", if choice { "HEADS" } else { "TAILS" });

    // TODO: Trigger VRF request via CPI to Switchboard
    // For now, VRF integration is stubbed

    Ok(())
}
