use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::state::{HouseConfig, PvpMatch, MatchStatus};
use crate::errors::MoltflipError;

#[derive(Accounts)]
pub struct PvpJoin<'info> {
    #[account(mut)]
    pub opponent: Signer<'info>,

    /// CHECK: Creator receiving potential payout
    #[account(mut)]
    pub creator: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"house"],
        bump = house.bump,
    )]
    pub house: Account<'info, HouseConfig>,

    #[account(
        mut,
        constraint = pvp_match.status == MatchStatus::Open @ MoltflipError::MatchNotOpen,
        constraint = pvp_match.creator != opponent.key() @ MoltflipError::CannotJoinOwnMatch,
        constraint = pvp_match.creator == creator.key() @ MoltflipError::Unauthorized,
    )]
    pub pvp_match: Account<'info, PvpMatch>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<PvpJoin>) -> Result<()> {
    let house = &ctx.accounts.house;
    let pvp_match = &mut ctx.accounts.pvp_match;
    
    require!(!house.paused, MoltflipError::HousePaused);

    // Check match hasn't expired (24 hour limit)
    let clock = Clock::get()?;
    let age = clock.unix_timestamp - pvp_match.created_at;
    require!(age < 86400, MoltflipError::MatchExpired);

    // Transfer opponent's bet to escrow
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.opponent.to_account_info(),
                to: pvp_match.to_account_info(),
            },
        ),
        pvp_match.amount,
    )?;

    pvp_match.opponent = ctx.accounts.opponent.key();
    pvp_match.status = MatchStatus::Matched;

    // TODO: Trigger VRF for fair resolution
    // For now, using slot-based placeholder (NOT SECURE)
    let vrf_bytes = clock.slot.to_le_bytes();
    let result = vrf_bytes[0] % 2 == 0; // true = heads
    
    pvp_match.result = result;
    pvp_match.resolved_at = clock.unix_timestamp;
    pvp_match.status = MatchStatus::Resolved;

    // Determine winner
    let creator_won = pvp_match.creator_choice == result;
    let winner = if creator_won { pvp_match.creator } else { pvp_match.opponent };
    pvp_match.winner = winner;

    // Calculate payout (total pot minus 1% fee)
    let total_pot = pvp_match.amount.checked_mul(2).ok_or(MoltflipError::Overflow)?;
    let fee = total_pot.checked_div(100).ok_or(MoltflipError::Overflow)?; // 1%
    let payout = total_pot.checked_sub(fee).ok_or(MoltflipError::Overflow)?;

    // Transfer fee to house
    let house = &mut ctx.accounts.house;
    **pvp_match.to_account_info().try_borrow_mut_lamports()? -= fee;
    **house.to_account_info().try_borrow_mut_lamports()? += fee;
    house.treasury_balance = house.treasury_balance.checked_add(fee).ok_or(MoltflipError::Overflow)?;
    house.house_profit = house.house_profit.checked_add(fee as i64).ok_or(MoltflipError::Overflow)?;

    // Transfer payout to winner
    let winner_account = if creator_won {
        ctx.accounts.creator.to_account_info()
    } else {
        ctx.accounts.opponent.to_account_info()
    };
    
    **pvp_match.to_account_info().try_borrow_mut_lamports()? -= payout;
    **winner_account.try_borrow_mut_lamports()? += payout;

    // Update stats
    house.total_flips = house.total_flips.checked_add(1).ok_or(MoltflipError::Overflow)?;
    house.total_volume = house.total_volume.checked_add(total_pot).ok_or(MoltflipError::Overflow)?;

    msg!("PvP match resolved!");
    msg!("Result: {}", if result { "HEADS" } else { "TAILS" });
    msg!("Winner: {}", winner);
    msg!("Payout: {} lamports", payout);
    msg!("House fee: {} lamports", fee);

    Ok(())
}
