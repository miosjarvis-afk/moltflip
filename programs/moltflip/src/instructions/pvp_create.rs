use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::state::{HouseConfig, PvpMatch, MatchStatus};
use crate::errors::MoltflipError;

#[derive(Accounts)]
pub struct PvpCreate<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        seeds = [b"house"],
        bump = house.bump,
    )]
    pub house: Account<'info, HouseConfig>,

    #[account(
        init,
        payer = creator,
        space = PvpMatch::SIZE,
        seeds = [b"pvp", creator.key().as_ref(), &Clock::get()?.slot.to_le_bytes()],
        bump
    )]
    pub pvp_match: Account<'info, PvpMatch>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<PvpCreate>,
    amount: u64,
    choice: bool,
) -> Result<()> {
    let house = &ctx.accounts.house;
    
    require!(!house.paused, MoltflipError::HousePaused);
    require!(amount > 0, MoltflipError::BetTooSmall);

    // Transfer bet to match escrow PDA
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.pvp_match.to_account_info(),
            },
        ),
        amount,
    )?;

    // Initialize match
    let pvp_match = &mut ctx.accounts.pvp_match;
    pvp_match.creator = ctx.accounts.creator.key();
    pvp_match.opponent = Pubkey::default();
    pvp_match.amount = amount;
    pvp_match.creator_choice = choice;
    pvp_match.status = MatchStatus::Open;
    pvp_match.winner = Pubkey::default();
    pvp_match.vrf_request = Pubkey::default();
    pvp_match.created_at = Clock::get()?.unix_timestamp;
    pvp_match.resolved_at = 0;
    pvp_match.result = false;
    pvp_match.bump = ctx.bumps.pvp_match;

    msg!("PvP match created");
    msg!("Creator: {}", pvp_match.creator);
    msg!("Amount: {} lamports", amount);
    msg!("Creator choice: {}", if choice { "HEADS" } else { "TAILS" });

    Ok(())
}
