use anchor_lang::prelude::*;
use crate::state::HouseConfig;
use crate::errors::MoltflipError;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"house"],
        bump = house.bump,
        constraint = house.authority == authority.key() @ MoltflipError::Unauthorized,
    )]
    pub house: Account<'info, HouseConfig>,
}

pub fn handler(
    ctx: Context<UpdateConfig>,
    house_edge_bps: Option<u16>,
    max_bet_bps: Option<u16>,
    paused: Option<bool>,
) -> Result<()> {
    let house = &mut ctx.accounts.house;

    if let Some(edge) = house_edge_bps {
        require!(edge <= 1000, MoltflipError::InvalidConfig); // Max 10%
        house.house_edge_bps = edge;
        msg!("House edge updated: {} bps", edge);
    }

    if let Some(max_bet) = max_bet_bps {
        require!(max_bet <= 500 && max_bet > 0, MoltflipError::InvalidConfig);
        house.max_bet_bps = max_bet;
        msg!("Max bet updated: {} bps", max_bet);
    }

    if let Some(pause) = paused {
        house.paused = pause;
        msg!("House paused: {}", pause);
    }

    Ok(())
}
