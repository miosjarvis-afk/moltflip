use anchor_lang::prelude::*;
use crate::state::HouseConfig;
use crate::errors::MoltflipError;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = HouseConfig::SIZE,
        seeds = [b"house"],
        bump
    )]
    pub house: Account<'info, HouseConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    house_edge_bps: u16,
    max_bet_bps: u16,
) -> Result<()> {
    // Validate config
    require!(house_edge_bps <= 1000, MoltflipError::InvalidConfig); // Max 10%
    require!(max_bet_bps <= 500, MoltflipError::InvalidConfig);     // Max 5%
    require!(max_bet_bps > 0, MoltflipError::InvalidConfig);

    let house = &mut ctx.accounts.house;
    house.authority = ctx.accounts.authority.key();
    house.treasury_balance = 0;
    house.house_edge_bps = house_edge_bps;
    house.max_bet_bps = max_bet_bps;
    house.total_flips = 0;
    house.total_volume = 0;
    house.house_profit = 0;
    house.paused = false;
    house.bump = ctx.bumps.house;

    msg!("Moltflip house initialized");
    msg!("Authority: {}", house.authority);
    msg!("House edge: {} bps", house_edge_bps);
    msg!("Max bet: {} bps of treasury", max_bet_bps);

    Ok(())
}
