const SERVICE_NAME: &str = "ShellPilot";

#[tauri::command]
pub fn save_credential(id: String, secret: String) -> Result<(), String> {
    write_credential_secret(&id, &secret)
}

#[tauri::command]
pub fn get_credential(id: String) -> Result<String, String> {
    read_credential_secret(&id)
}

#[tauri::command]
pub fn delete_credential(id: String) -> Result<(), String> {
    delete_credential_secret(&id)
}

pub fn write_credential_secret(id: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &id)
        .map_err(|error| format!("failed to open credential entry: {error}"))?;

    entry
        .set_password(secret)
        .map_err(|error| format!("failed to save credential: {error}"))
}

pub fn read_credential_secret(id: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &id)
        .map_err(|error| format!("failed to open credential entry: {error}"))?;

    entry
        .get_password()
        .map_err(|error| format!("password is not saved in secure storage: {error}"))
}

pub fn delete_credential_secret(id: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &id)
        .map_err(|error| format!("failed to open credential entry: {error}"))?;

    entry
        .delete_credential()
        .map_err(|error| format!("failed to delete credential: {error}"))
}
