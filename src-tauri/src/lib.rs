mod commands;

use commands::ai::AiRunStore;
use commands::local_pty::LocalPtySessionStore;
use commands::rdp::RdpSessionStore;
use commands::sftp::SftpSessionStore;
use commands::ssh::SshSessionStore;

#[tauri::command]
fn app_ready() -> String {
    "ShellPilot backend is ready".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LocalPtySessionStore::default())
        .manage(AiRunStore::default())
        .manage(RdpSessionStore::default())
        .manage(SftpSessionStore::default())
        .manage(SshSessionStore::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            app_ready,
            commands::ai::ai_cancel_prompt,
            commands::ai::ai_list_providers,
            commands::ai::ai_run_prompt,
            commands::ai::ai_run_prompt_stream,
            commands::credentials::delete_credential,
            commands::credentials::get_credential,
            commands::credentials::save_credential,
            commands::local_pty::local_pty_close,
            commands::local_pty::local_pty_open,
            commands::local_pty::local_pty_resize,
            commands::local_pty::local_pty_write,
            commands::local_pty::open_elevated_local_terminal,
            commands::rdp::rdp_close,
            commands::rdp::rdp_forget_certificate,
            commands::rdp::rdp_open,
            commands::rdp::rdp_paste_clipboard_files,
            commands::rdp::rdp_send_input,
            commands::rdp::rdp_set_local_clipboard_text,
            commands::rdp::rdp_set_windows_key_capture,
            commands::sessions::load_session_registry,
            commands::sessions::save_session_registry,
            commands::ssh::clear_ssh_known_hosts,
            commands::ssh::connect_ssh_password,
            commands::ssh::forget_ssh_known_host,
            commands::ssh::list_ssh_known_hosts,
            commands::ssh::probe_ssh_connection,
            commands::ssh::ssh_close,
            commands::ssh::ssh_open_shell,
            commands::ssh::ssh_run_readonly_commands,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_write,
            commands::sftp::sftp_close,
            commands::sftp::sftp_cancel_transfer,
            commands::sftp::reveal_local_path,
            commands::sftp::sftp_download,
            commands::sftp::sftp_keepalive,
            commands::sftp::sftp_list,
            commands::sftp::sftp_mkdir,
            commands::sftp::sftp_open,
            commands::sftp::sftp_remove_dir,
            commands::sftp::sftp_remove_file,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_upload_stream_chunk,
            commands::sftp::sftp_upload_stream_close,
            commands::sftp::sftp_upload_stream_open
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShellPilot");
}
