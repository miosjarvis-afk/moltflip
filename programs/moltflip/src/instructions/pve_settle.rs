use anchor_lang::prelude::*;
use crate::state::{HouseConfig, PendingFlip};
use crate::errors::MoltflipError;

#[derive(Accounts)]
pub struct PveSettle<'info> {
    /// CHECK: Player receiving payout
    #[account(mut)]
    pub player: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"house"],
        bump = house.bump,
    )]
    pub house: Account<'info, HouseConfig>,

    #[account(
        mut,
        close = player,
        seeds = [b"pending", player.key().as_ref()],
        bump = pending_flip.bump,
        constraint = pending_flip.player == player.key() @ MoltflipError::Unauthorized
    )]
    pub pending_flip: Account<'info, PendingFlip>,

    /// CHECK: VRF result account - validated manually
    pub vrf_result: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<PveSettle>) -> Result<()> {
    let pending = &ctx.accounts.pending_flip;
    let house = &mut ctx.accounts.house;

    // TODO: Actually read VRF result from Switchboard
    // For now, using a deterministic placeholder based on slot
    // THIS IS NOT SECURE - REPLACE WITH REAL VRF
    let clock = Clock::get()?;
    let vrf_bytes = clock.slot.to_le_bytes();
    let result = vrf_bytes[0] % 2 == 0; // true = heads

    let player_won = pending.choice == result;

    if player_won {
        // Calculate payout: bet * 2 * (1 - house_edge)
        let gross_payout = pending.amount
            .checked_mul(2)
            .ok_or(MoltflipError::Overflow)?;
        
        let payout = gross_payout
            .checked_mul(10000 - house.house_edge_bps as u64)
            .ok_or(MoltflipError::Overflow)?
            .checked_div(10000)
            .ok_or(MoltflipError::Overflow)?;

        // Transfer winnings to player
        **house.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.player.try_borrow_mut_lamports()? += payout;

        // Update house profit (negative = loss)
        let loss = (payout as i64) - (pending.amount as i64);
        house.house_profit = house.house_profit.checked_sub(loss).ok_or(MoltflipError::Overflow)?;
        house.treasury_balance = house.treasury_balance.checked_sub(payout).ok_or(MoltflipError::Overflow)?;

        msg!("Player WON!");
        msg!("Payout: {} lamports", payout);
    } else {
        // House keeps the bet
        house.house_profit = house.house_profit.checked_add(pending.amount as i64).ok_or(MoltflipError::Overflow)?;
        
        msg!("Player LOST");
        msg!("House keeps: {} lamports", pending.amount);
    }

    msg!("Result: {}", if result { "HEADS" } else { "TAILS" });
    msg!("Player choice: {}", if pending.choice { "HEADS" } else { "TAILS" });

    Ok(())
}
