use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub(super) filename: String,
    pub(super) owner: Option<String>,
    pub(super) is_directory: bool,
    pub(super) kind: String,
    pub(super) modified_at: Option<u32>,
    pub(super) path: String,
    pub(super) permissions: Option<String>,
    pub(super) size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListResult {
    pub(super) entries: Vec<SftpEntry>,
    pub(super) path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileEntry {
    pub(super) filename: String,
    pub(super) is_directory: bool,
    pub(super) kind: String,
    pub(super) modified_at: Option<u64>,
    pub(super) path: String,
    pub(super) size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalListResult {
    pub(super) entries: Vec<LocalFileEntry>,
    pub(super) path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRootEntry {
    pub(super) label: String,
    pub(super) path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRootsResult {
    pub(super) roots: Vec<LocalRootEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPathMetadata {
    pub(super) modified_at: Option<u64>,
    pub(super) size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferEvent {
    pub(super) direction: SftpTransferDirection,
    pub(super) message: Option<String>,
    pub(super) panel_id: String,
    pub(super) remote_path: String,
    pub(super) local_path: String,
    pub(super) status: SftpTransferStatus,
    pub(super) total_bytes: u64,
    pub(super) transferred_bytes: u64,
    pub(super) transfer_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferDirection {
    Download,
    Upload,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferStatus {
    Canceled,
    Completed,
    Failed,
    Progress,
    Started,
}

pub(super) struct SftpTransferRequest {
    pub(super) download_id: String,
    pub(super) direction: SftpTransferDirection,
    pub(super) local_path: String,
    pub(super) panel_id: String,
    pub(super) remote_path: String,
    pub(super) transfer_id: String,
    pub(super) upload_id: String,
}
