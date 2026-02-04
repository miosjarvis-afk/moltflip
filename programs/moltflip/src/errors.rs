use anchor_lang::prelude::*;

#[error_code]
pub enum MoltflipError {
    #[msg("House is paused")]
    HousePaused,

    #[msg("Bet amount exceeds maximum allowed")]
    BetTooLarge,

    #[msg("Bet amount is zero")]
    BetTooSmall,

    #[msg("Insufficient treasury balance")]
    InsufficientTreasury,

    #[msg("Match is not open")]
    MatchNotOpen,

    #[msg("Match has expired")]
    MatchExpired,

    #[msg("Cannot join your own match")]
    CannotJoinOwnMatch,

    #[msg("Not authorized")]
    Unauthorized,

    #[msg("Invalid VRF result")]
    InvalidVrfResult,

    #[msg("VRF not yet fulfilled")]
    VrfNotFulfilled,

    #[msg("Flip already settled")]
    AlreadySettled,

    #[msg("Match cannot be cancelled")]
    CannotCancel,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Invalid configuration value")]
    InvalidConfig,
}
