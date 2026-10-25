use lambda_runtime::{service_fn, Error, LambdaEvent};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};

static INVOCATIONS: AtomicUsize = AtomicUsize::new(0);

async fn handler(event: LambdaEvent<Value>) -> Result<Value, Error> {
    if event.payload.get("fail").and_then(Value::as_bool) == Some(true) {
        return Err(std::io::Error::other("Requested Rust handler failure").into());
    }
    let invocation = INVOCATIONS.fetch_add(1, Ordering::SeqCst) + 1;
    println!("Rust invocation {invocation}");
    Ok(json!({
        "message": "Hello from Rust on Floci",
        "event": event.payload,
        "invocation": invocation,
        "requestId": event.context.request_id,
    }))
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    lambda_runtime::run(service_fn(handler)).await
}
