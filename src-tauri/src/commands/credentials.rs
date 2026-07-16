const SERVICE_NAME: &str = "ShellPilot";

#[tauri::command]
pub fn save_credential(id: String, secret: String) -> Result<(), String> {
    validate_credential_id(&id)?;
    write_credential_secret(&id, &secret)
}

#[tauri::command]
pub fn delete_credential(id: String) -> Result<(), String> {
    validate_credential_id(&id)?;
    delete_credential_secret(&id)
}

/// Renderer-supplied credential ids are otherwise an unrestricted key into the
/// OS keyring under our service name — this confines save/delete to ids that
/// actually match the `createCredentialId(sessionId, kind)` shape the frontend
/// generates (`session.security.ts`), rejecting arbitrary/malformed ids.
/// This can't fully scope an id to "the session currently being edited" (a
/// credential save happens before that session is ever persisted to the
/// registry, so there's nothing yet to check ownership against), but it does
/// stop this from being a free-form keyring read/write/delete primitive.
fn validate_credential_id(id: &str) -> Result<(), String> {
    let Some(rest) = id.strip_prefix("shellpilot_") else {
        return Err("invalid credential id".to_string());
    };

    let Some(session_part) = rest
        .strip_suffix("_password")
        .or_else(|| rest.strip_suffix("_key"))
    else {
        return Err("invalid credential id".to_string());
    };

    let is_valid = !session_part.is_empty()
        && session_part
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-');

    if is_valid {
        Ok(())
    } else {
        Err("invalid credential id".to_string())
    }
}

pub fn write_credential_secret(id: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &id)
        .map_err(|error| format!("failed to open credential entry: {error}"))?;

    entry
        .set_password(secret)
        .map_err(|error| format!("failed to save credential: {error}"))
}

pub fn read_credential_secret(id: &str) -> Result<String, String> {
    validate_credential_id(id)?;

    let entry = keyring::Entry::new(SERVICE_NAME, &id)
        .map_err(|error| format!("failed to open credential entry: {error}"))?;

    entry
        .get_password()
        .map_err(|error| format!("password is not saved in secure storage: {error}"))
}

pub fn read_optional_credential_secret(id: &str) -> Result<Option<String>, String> {
    validate_credential_id(id)?;

    let entry = keyring::Entry::new(SERVICE_NAME, &id)
        .map_err(|error| format!("failed to open credential entry: {error}"))?;

    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "failed to read credential from secure storage: {error}"
        )),
    }
}

pub fn delete_credential_secret(id: &str) -> Result<(), String> {
    validate_credential_id(id)?;

    let entry = keyring::Entry::new(SERVICE_NAME, &id)
        .map_err(|error| format!("failed to open credential entry: {error}"))?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("failed to delete credential: {error}")),
    }
}
