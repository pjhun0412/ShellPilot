mod commands;

use commands::sftp::SftpSessionStore;
use commands::ssh::SshSessionStore;

#[tauri::command]
fn app_ready() -> String {
    "ShellPilot backend is ready".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SftpSessionStore::default())
        .manage(SshSessionStore::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            app_ready,
            commands::credentials::delete_credential,
            commands::credentials::get_credential,
            commands::credentials::save_credential,
            commands::sessions::load_session_registry,
            commands::sessions::save_session_registry,
            commands::ssh::clear_ssh_known_hosts,
            commands::ssh::connect_ssh_password,
            commands::ssh::forget_ssh_known_host,
            commands::ssh::list_ssh_known_hosts,
            commands::ssh::probe_ssh_connection,
            commands::ssh::ssh_close,
            commands::ssh::ssh_open_shell,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_write,
            commands::sftp::sftp_close,
            commands::sftp::sftp_cancel_transfer,
            commands::sftp::sftp_download,
            commands::sftp::sftp_list,
            commands::sftp::sftp_mkdir,
            commands::sftp::sftp_open,
            commands::sftp::sftp_remove_dir,
            commands::sftp::sftp_remove_file,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_upload
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShellPilot");
}
