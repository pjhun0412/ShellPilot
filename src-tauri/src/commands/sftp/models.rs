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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{SftpTransferDirection, SftpTransferEvent, SftpTransferStatus};

    #[test]
    fn transfer_event_serializes_fields_and_variants_in_camel_case() {
        let event = SftpTransferEvent {
            direction: SftpTransferDirection::Download,
            message: Some("Resuming from 1.5 KB".to_string()),
            panel_id: "panel-1".to_string(),
            remote_path: "/remote/file.txt".to_string(),
            local_path: "C:\\downloads\\file.txt".to_string(),
            status: SftpTransferStatus::Started,
            total_bytes: 4096,
            transferred_bytes: 1536,
            transfer_id: "transfer-1".to_string(),
        };

        assert_eq!(
            serde_json::to_value(event).expect("transfer event should serialize"),
            json!({
                "direction": "download",
                "message": "Resuming from 1.5 KB",
                "panelId": "panel-1",
                "remotePath": "/remote/file.txt",
                "localPath": "C:\\downloads\\file.txt",
                "status": "started",
                "totalBytes": 4096,
                "transferredBytes": 1536,
                "transferId": "transfer-1",
            })
        );
    }
}
