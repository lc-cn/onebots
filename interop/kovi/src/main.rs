use futures_util::StreamExt;
use kovi::bot::SendApi;
use kovi::driver::{Driver, DriverEvent};
use kovi_onebot::{Host, OneBotDriver, OneBotDriverConfig, Server};
use serde_json::{Value, json};
use std::env;
use std::fs;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let host = required("ONEBOTS_INTEROP_HOST")?;
    let port = required("ONEBOTS_INTEROP_PORT")?.parse::<u16>()?;
    let path = required("ONEBOTS_INTEROP_PATH")?;
    let token = required("ONEBOTS_INTEROP_TOKEN")?;
    let evidence_path = required("ONEBOTS_INTEROP_EVIDENCE")?;
    let driver = OneBotDriver::new(OneBotDriverConfig {
        server: Server::new(Host::Domain(host), port, token, false, path, false),
    });

    let mut events = driver.event_channel().await?;
    let event = loop {
        match events.next().await {
            Some(Ok(DriverEvent::Normal(event)))
                if event.get("post_type") == Some(&json!("message")) =>
            {
                break event;
            }
            Some(Ok(DriverEvent::Normal(_))) => {}
            Some(Ok(DriverEvent::Exit)) => return Err("Kovi event connection exited".into()),
            Some(Err(error)) => return Err(error),
            None => return Err("Kovi event stream ended".into()),
        }
    };
    let login = api(&driver, "get_login_info", json!({})).await?;
    let send = api(
        &driver,
        "send_private_msg",
        json!({
            "user_id": event.get("user_id").cloned().unwrap_or(json!(10001)),
            "message": "onebots-kovi-interop-reply"
        }),
    )
    .await?;
    let evidence = json!({
        "framework": "kovi",
        "frameworkVersion": "0.13.0",
        "adapterVersion": "0.13.2",
        "event": event,
        "login": login,
        "send": send
    });
    fs::write(evidence_path, serde_json::to_vec(&evidence)?)?;
    std::future::pending::<()>().await;
    #[allow(unreachable_code)]
    Ok(())
}

async fn api(
    driver: &OneBotDriver,
    action: &str,
    params: Value,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    match driver.api_handler(SendApi::new(action, params)).await? {
        Ok(response) => Ok(response.data),
        Err(response) => Err(format!("Kovi API {action} failed: {response}").into()),
    }
}

fn required(name: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    env::var(name).map_err(|_| format!("{name} is required").into())
}
