mod core;

use core::{backend, cookie_value, new_session, verify_session, SESSION_COOKIE};
use serde_json::json;
use worker::*;

fn now_ms() -> u64 {
    Date::now().as_millis() as u64
}

fn login_page(error: bool) -> Result<Response> {
    let error_text = if error {
        "<p>Forkert adgangskode.</p>"
    } else {
        ""
    };
    let html = format!(
        r#"<!doctype html><html lang="da"><meta name="viewport" content="width=device-width"><title>Privat LynStemme</title><style>body{{font:18px system-ui;background:#07111f;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}}form{{width:min(90vw,360px);padding:2rem;background:#10213a;border-radius:18px}}input,button{{box-sizing:border-box;width:100%;padding:.9rem;margin-top:1rem;border-radius:10px;border:1px solid #547;background:#fff;color:#111}}button{{background:#42d3a2;border:0;font-weight:700}}p{{color:#ff9d9d}}</style><form method="post" action="/login"><h1>LynStemme</h1><div>Privat test for Andreas</div>{error_text}<input type="password" name="password" autocomplete="current-password" aria-label="Adgangskode" required autofocus><button>Log ind</button></form></html>"#
    );
    let status = if error { 401 } else { 403 };
    let mut response = Response::from_html(html)?.with_status(status);
    response.headers_mut().set("cache-control", "no-store")?;
    response
        .headers_mut()
        .set("x-robots-tag", "noindex, nofollow")?;
    Ok(response)
}

fn is_authorized(req: &Request, secret: &str) -> bool {
    req.headers()
        .get("cookie")
        .ok()
        .flatten()
        .and_then(|header| cookie_value(&header, SESSION_COOKIE))
        .is_some_and(|token| verify_session(secret, &token, now_ms()))
}

async fn handle_login(mut req: Request, secret: &str) -> Result<Response> {
    let body = req.text().await?;
    let supplied = body
        .split('&')
        .find_map(|part| {
            let (key, value) = part.split_once('=')?;
            (key == "password").then(|| urlencoding_decode(value))
        })
        .unwrap_or_default();
    if !core::constant_time_eq(supplied.as_bytes(), secret.as_bytes()) {
        return login_page(true);
    }
    let token = new_session(secret, now_ms());
    let mut response = Response::empty()?.with_status(303);
    response.headers_mut().set("location", "/")?;
    response.headers_mut().set(
        "set-cookie",
        &format!(
            "{SESSION_COOKIE}={token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400"
        ),
    )?;
    response.headers_mut().set("cache-control", "no-store")?;
    Ok(response)
}

fn urlencoding_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &input[i + 1..i + 3];
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[event(fetch)]
pub async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let secret = match env.secret("APP_PASSWORD") {
        Ok(value) => value.to_string(),
        Err(_) => {
            return Ok(Response::error(
                "Private deployment is not configured",
                503,
            )?)
        }
    };
    let path = req.path();
    if path == "/login" && req.method() == Method::Post {
        return handle_login(req, &secret).await;
    }
    if !is_authorized(&req, &secret) {
        return login_page(false);
    }
    if path == "/health" {
        let configured = env.var("AI_BACKEND").ok().map(|v| v.to_string());
        let has_groq = env.secret("GROQ_API_KEY").is_ok();
        return Response::from_json(
            &json!({"status":"ok","access":"private","runtime":"rust-wasm","backend":backend(configured.as_deref(),has_groq),"voice_gateway":"typescript-service-binding","language":"da-DK"}),
        );
    }
    if path.starts_with("/agents/") || path == "/stt-check" || path == "/stt-audio-test" {
        return env.service("VOICE_GATEWAY")?.fetch_request(req).await;
    }
    env.assets("ASSETS")?.fetch_request(req).await
}
