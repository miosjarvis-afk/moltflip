use anchor_lang::prelude::*;
use crate::state::HouseConfig;
use crate::errors::MoltflipError;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"house"],
        bump = house.bump,
        constraint = house.authority == authority.key() @ MoltflipError::Unauthorized,
    )]
    pub house: Account<'info, HouseConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let house = &mut ctx.accounts.house;

    require!(amount <= house.treasury_balance, MoltflipError::InsufficientTreasury);

    // Leave minimum balance for rent exemption
    let min_balance = Rent::get()?.minimum_balance(HouseConfig::SIZE);
    let available = house.to_account_info().lamports().saturating_sub(min_balance);
    require!(amount <= available, MoltflipError::InsufficientTreasury);

    // Transfer from house PDA to authority
    **house.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.authority.try_borrow_mut_lamports()? += amount;

    house.treasury_balance = house.treasury_balance.checked_sub(amount).ok_or(MoltflipError::Overflow)?;

    msg!("Withdrawal successful");
    msg!("Amount: {} lamports", amount);
    msg!("Remaining treasury: {} lamports", house.treasury_balance);

    Ok(())
}
