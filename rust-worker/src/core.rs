use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub const SESSION_COOKIE: &str = "lynstemme_session";
pub const SESSION_TTL_MS: u64 = 24 * 60 * 60 * 1000;
#[allow(dead_code)]
pub const SYSTEM_PROMPT: &str = "Du er LynStemme, en dansk AI-stemmeassistent. Du skal altid svare på naturligt dansk, også når brugeren taler et andet sprog, medmindre brugeren udtrykkeligt beder om en oversættelse. Brug korte sætninger, danske ord og dansk talestil.";

pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

pub fn sign(secret: &str, expiry_ms: u64) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key size");
    mac.update(expiry_ms.to_string().as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

pub fn new_session(secret: &str, now_ms: u64) -> String {
    let expiry = now_ms.saturating_add(SESSION_TTL_MS);
    format!("{expiry}.{}", sign(secret, expiry))
}

pub fn verify_session(secret: &str, value: &str, now_ms: u64) -> bool {
    let Some((expiry, supplied)) = value.split_once('.') else {
        return false;
    };
    let Ok(expiry) = expiry.parse::<u64>() else {
        return false;
    };
    if expiry < now_ms {
        return false;
    }
    let expected = sign(secret, expiry);
    constant_time_eq(supplied.as_bytes(), expected.as_bytes())
}

pub fn cookie_value(header: &str, name: &str) -> Option<String> {
    header.split(';').map(str::trim).find_map(|part| {
        let (key, value) = part.split_once('=')?;
        (key == name).then(|| value.to_string())
    })
}

pub fn backend(ai_backend: Option<&str>, has_groq: bool) -> &'static str {
    match ai_backend.unwrap_or("auto") {
        "local" => "local",
        "groq" => "groq",
        "workers-ai" => "workers-ai",
        "auto" if has_groq => "groq",
        _ => "workers-ai",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_round_trip_and_expiry() {
        let token = new_session("correct horse", 1_000);
        assert!(verify_session("correct horse", &token, 1_001));
        assert!(!verify_session("wrong", &token, 1_001));
        assert!(!verify_session(
            "correct horse",
            &token,
            1_000 + SESSION_TTL_MS + 1
        ));
    }

    #[test]
    fn malformed_sessions_fail_closed() {
        for token in ["", "123", "x.y", "1.", ".abc", "1.a.b"] {
            assert!(!verify_session("secret", token, 0), "accepted {token:?}");
        }
    }

    #[test]
    fn cookie_parser_matches_exact_name() {
        assert_eq!(
            cookie_value("x=1; lynstemme_session=a.b; y=2", SESSION_COOKIE).as_deref(),
            Some("a.b")
        );
        assert_eq!(
            cookie_value("not_lynstemme_session=a.b", SESSION_COOKIE),
            None
        );
    }

    #[test]
    fn backend_selection_preserves_fallback_order() {
        assert_eq!(backend(None, true), "groq");
        assert_eq!(backend(Some("auto"), false), "workers-ai");
        assert_eq!(backend(Some("local"), true), "local");
    }
}
