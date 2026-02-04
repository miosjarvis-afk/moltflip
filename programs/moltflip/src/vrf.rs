use anchor_lang::prelude::*;

/// VRF Account structure for Switchboard integration
/// This wraps the Switchboard VRF functionality
#[derive(Clone)]
pub struct SwitchboardVrf;

impl anchor_lang::Id for SwitchboardVrf {
    fn id() -> Pubkey {
        // Switchboard V2 Program ID (Mainnet/Devnet)
        pubkey!("SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f")
    }
}

/// VRF Request Account (simplified for our use case)
#[account]
pub struct VrfRequest {
    /// Authority that can consume the result
    pub authority: Pubkey,
    
    /// The VRF result (32 bytes of randomness)
    pub result: [u8; 32],
    
    /// Whether the result has been fulfilled
    pub fulfilled: bool,
    
    /// Request timestamp
    pub request_slot: u64,
    
    /// Fulfillment timestamp  
    pub fulfilled_slot: u64,
    
    /// Bump seed
    pub bump: u8,
}

impl VrfRequest {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 8 + 1 + 32;
    
    /// Get a deterministic boolean from VRF result
    /// Uses first byte: even = heads (true), odd = tails (false)
    pub fn get_flip_result(&self) -> bool {
        self.result[0] % 2 == 0
    }
    
    /// Get a value between 0-99 for percentage-based outcomes
    pub fn get_percentage(&self) -> u8 {
        self.result[0] % 100
    }
}

/// Helper to verify VRF result is valid and recent
pub fn verify_vrf_result(
    vrf: &VrfRequest,
    max_age_slots: u64,
    current_slot: u64,
) -> Result<bool> {
    // Check if fulfilled
    require!(vrf.fulfilled, VrfError::NotFulfilled);
    
    // Check if result is recent enough (prevent replay)
    let age = current_slot.saturating_sub(vrf.fulfilled_slot);
    require!(age <= max_age_slots, VrfError::ResultExpired);
    
    Ok(vrf.get_flip_result())
}

#[error_code]
pub enum VrfError {
    #[msg("VRF result not yet fulfilled")]
    NotFulfilled,
    
    #[msg("VRF result has expired")]
    ResultExpired,
    
    #[msg("Invalid VRF proof")]
    InvalidProof,
}

/// For devnet testing: deterministic "VRF" based on slot + blockhash
/// DO NOT USE IN PRODUCTION - this is predictable!
pub fn devnet_random(slot: u64, blockhash: &[u8]) -> [u8; 32] {
    use anchor_lang::solana_program::hash::hash;
    
    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(&slot.to_le_bytes());
    data.extend_from_slice(blockhash);
    
    hash(&data).to_bytes()
}
