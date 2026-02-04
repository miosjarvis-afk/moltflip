use anchor_lang::prelude::*;
use crate::state::{PvpMatch, MatchStatus};
use crate::errors::MoltflipError;

#[derive(Accounts)]
pub struct PvpCancel<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        close = creator,
        constraint = pvp_match.creator == creator.key() @ MoltflipError::Unauthorized,
        constraint = pvp_match.status == MatchStatus::Open @ MoltflipError::CannotCancel,
    )]
    pub pvp_match: Account<'info, PvpMatch>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<PvpCancel>) -> Result<()> {
    // Refund is automatic via close = creator
    // The account's lamports (including the bet) go back to creator

    msg!("PvP match cancelled");
    msg!("Refunded: {} lamports", ctx.accounts.pvp_match.amount);

    Ok(())
}
