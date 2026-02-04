use anchor_lang::prelude::*;

/// House configuration and treasury
#[account]
#[derive(Default)]
pub struct HouseConfig {
    /// Admin authority (can withdraw, update config)
    pub authority: Pubkey,
    
    /// Treasury balance (lamports)
    pub treasury_balance: u64,
    
    /// House edge in basis points (200 = 2%)
    pub house_edge_bps: u16,
    
    /// Max bet as basis points of treasury (100 = 1%)
    pub max_bet_bps: u16,
    
    /// Total flips executed
    pub total_flips: u64,
    
    /// Total volume (lamports)
    pub total_volume: u64,
    
    /// Total profit for house (can be negative)
    pub house_profit: i64,
    
    /// Pause flag for emergencies
    pub paused: bool,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl HouseConfig {
    pub const SIZE: usize = 8 +  // discriminator
        32 +  // authority
        8 +   // treasury_balance
        2 +   // house_edge_bps
        2 +   // max_bet_bps
        8 +   // total_flips
        8 +   // total_volume
        8 +   // house_profit (i64)
        1 +   // paused
        1 +   // bump
        64;   // padding for future fields

    pub fn max_bet(&self) -> u64 {
        (self.treasury_balance as u128 * self.max_bet_bps as u128 / 10000) as u64
    }
}

/// Pending PvE flip waiting for VRF
#[account]
pub struct PendingFlip {
    /// Player wallet
    pub player: Pubkey,
    
    /// Bet amount (lamports)
    pub amount: u64,
    
    /// Player's choice (true = heads)
    pub choice: bool,
    
    /// VRF request account
    pub vrf_request: Pubkey,
    
    /// Timestamp of request
    pub created_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

impl PendingFlip {
    pub const SIZE: usize = 8 +  // discriminator
        32 +  // player
        8 +   // amount
        1 +   // choice
        32 +  // vrf_request
        8 +   // created_at
        1 +   // bump
        32;   // padding
}

/// PvP Match (escrow)
#[account]
pub struct PvpMatch {
    /// Creator wallet
    pub creator: Pubkey,
    
    /// Opponent wallet (Pubkey::default() if open)
    pub opponent: Pubkey,
    
    /// Bet amount per side (lamports)
    pub amount: u64,
    
    /// Creator's choice (true = heads)
    pub creator_choice: bool,
    
    /// Match status
    pub status: MatchStatus,
    
    /// Winner (set after resolution)
    pub winner: Pubkey,
    
    /// VRF request (set when matched)
    pub vrf_request: Pubkey,
    
    /// Creation timestamp
    pub created_at: i64,
    
    /// Resolution timestamp
    pub resolved_at: i64,
    
    /// The flip result (true = heads)
    pub result: bool,
    
    /// Bump seed
    pub bump: u8,
}

impl PvpMatch {
    pub const SIZE: usize = 8 +  // discriminator
        32 +  // creator
        32 +  // opponent
        8 +   // amount
        1 +   // creator_choice
        1 +   // status
        32 +  // winner
        32 +  // vrf_request
        8 +   // created_at
        8 +   // resolved_at
        1 +   // result
        1 +   // bump
        32;   // padding
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum MatchStatus {
    #[default]
    Open,       // Waiting for opponent
    Matched,    // Opponent joined, waiting for VRF
    Resolved,   // Flip complete
    Cancelled,  // Creator cancelled
    Expired,    // Timed out
}

/// Flip history record (optional, for indexing)
#[account]
pub struct FlipRecord {
    /// Game ID (incrementing)
    pub game_id: u64,
    
    /// Player wallet
    pub player: Pubkey,
    
    /// Opponent (Pubkey::default() for PvE)
    pub opponent: Pubkey,
    
    /// Bet amount
    pub amount: u64,
    
    /// Player choice
    pub choice: bool,
    
    /// Result (true = heads)
    pub result: bool,
    
    /// Did player win?
    pub player_won: bool,
    
    /// Payout amount
    pub payout: u64,
    
    /// Timestamp
    pub timestamp: i64,
    
    /// Was this PvP?
    pub is_pvp: bool,
    
    /// Bump
    pub bump: u8,
}

impl FlipRecord {
    pub const SIZE: usize = 8 +  // discriminator
        8 +   // game_id
        32 +  // player
        32 +  // opponent
        8 +   // amount
        1 +   // choice
        1 +   // result
        1 +   // player_won
        8 +   // payout
        8 +   // timestamp
        1 +   // is_pvp
        1 +   // bump
        16;   // padding
}
