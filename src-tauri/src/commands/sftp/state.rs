use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc},
};

use russh::client;
use russh_sftp::client::{fs::File as SftpRemoteFile, SftpSession};
use tokio::sync::{Mutex, Notify};

use crate::commands::ssh::ShellPilotSshClient;

use super::models::SftpTransferRequest;

#[derive(Default)]
pub struct SftpSessionStore {
    pub(super) sessions: Mutex<HashMap<String, Arc<Mutex<SftpConnection>>>>,
    pub(super) stream_uploads: Mutex<HashMap<String, SftpUploadStream>>,
    pub(super) transfers: Arc<Mutex<HashMap<String, Arc<SftpTransferControl>>>>,
}

pub(super) struct SftpConnection {
    pub(super) groups: HashMap<u32, String>,
    pub(super) session: Arc<SftpSession>,
    pub(super) ssh: client::Handle<ShellPilotSshClient>,
    pub(super) users: HashMap<u32, String>,
}

pub(super) struct SftpUploadStream {
    pub(super) control: Arc<SftpTransferControl>,
    pub(super) file: SftpRemoteFile,
    pub(super) request: SftpTransferRequest,
    pub(super) temp_remote_path: String,
    pub(super) total_bytes: u64,
    pub(super) transferred_bytes: u64,
}

#[derive(Default)]
pub(super) struct SftpTransferControl {
    pub(super) canceled: AtomicBool,
    pub(super) paused: AtomicBool,
    pub(super) notify: Notify,
}
