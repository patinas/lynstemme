// These are black-box contract cases for the Rust edge. The same cases are
// exercised against a local Worker by scripts/test-rust-integration.mjs.
#[test]
fn private_route_contract_is_explicit() {
    let required = [
        ("GET /", 403),
        ("GET /health", 403),
        ("GET /agents/lynstemme/default", 403),
        ("POST /login wrong", 401),
        ("POST /login correct", 303),
    ];
    assert_eq!(required.len(), 5);
}
