use super::auth::SshAuthRequest;

#[derive(Debug)]
pub(crate) struct SshFailure {
    pub(crate) auth_prompt: bool,
    pub(crate) code: &'static str,
    pub(crate) message: String,
    pub(crate) retryable: bool,
}

impl SshFailure {
    pub(crate) fn auth(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: true,
            code: "auth_failed",
            message: message.into(),
            retryable: true,
        }
    }

    pub(crate) fn auth_with_code(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code,
            message: message.into(),
            retryable: true,
        }
    }

    pub(crate) fn connection(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code: "connection_failed",
            message: message.into(),
            retryable: true,
        }
    }

    pub(crate) fn connection_with_code(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code,
            message: message.into(),
            retryable: true,
        }
    }

    pub(crate) fn host_key(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code: "host_key_mismatch",
            message: message.into(),
            retryable: false,
        }
    }

    pub(crate) fn unknown_host_key(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code: "host_key_unknown",
            message: message.into(),
            retryable: true,
        }
    }

    pub(crate) fn session(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code: "session_failed",
            message: message.into(),
            retryable: true,
        }
    }
}

impl From<String> for SshFailure {
    fn from(message: String) -> Self {
        Self::session(message)
    }
}

pub(crate) fn classify_auth_error(error: String, auth: &SshAuthRequest) -> SshFailure {
    let label = auth.label();
    let lower = error.to_ascii_lowercase();

    if is_secure_storage_access_error(&lower) {
        return SshFailure::auth_with_code(
            "auth_missing",
            format!(
                "Saved {label} could not be read from the operating-system credential store. Enter the {label} again to continue. {error}"
            ),
        );
    }

    if matches!(auth, SshAuthRequest::Agent) {
        return SshFailure::auth_with_code(
            "agent_failed",
            format!("SSH agent authentication failed. Make sure OpenSSH Agent or Pageant is running and has a valid identity loaded. {error}"),
        );
    }

    SshFailure::auth(format!("SSH {label} authentication failed. {error}"))
}

fn is_secure_storage_access_error(lower: &str) -> bool {
    lower.contains("secure storage")
        || lower.contains("credential store")
        || lower.contains("keychain")
        || lower.contains("keyring")
        || lower.contains("user interaction is not allowed")
        || lower.contains("interaction is not allowed")
}

pub(crate) fn classify_connect_error(error: String) -> SshFailure {
    let lower = error.to_ascii_lowercase();

    if lower.contains("unknown server key") || lower.contains("unknownkey") {
        return SshFailure::unknown_host_key(
            "SSH host key is not trusted yet. Verify the fingerprint and trust this server to continue.",
        );
    }

    if lower.contains("key changed") {
        return SshFailure::host_key(format!("SSH host key verification failed. {error}"));
    }

    if is_host_key_verification_error(&lower) {
        return SshFailure::host_key(format!("SSH host key verification failed. {error}"));
    }

    if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connectiontimeout")
    {
        return SshFailure::connection_with_code(
            "connection_timeout",
            format!(
                "SSH connection timed out. Check network reachability and firewall rules. {error}"
            ),
        );
    }

    if lower.contains("refused") || lower.contains("10061") {
        return SshFailure::connection_with_code(
            "connection_refused",
            format!(
                "SSH connection was refused. Check that SSH is running on the target port. {error}"
            ),
        );
    }

    if lower.contains("no route")
        || lower.contains("network unreachable")
        || lower.contains("10065")
    {
        return SshFailure::connection_with_code(
            "network_unreachable",
            format!("SSH network is unreachable. Check routing, VPN, and firewall rules. {error}"),
        );
    }

    if lower.contains("resolve")
        || lower.contains("lookup")
        || lower.contains("dns")
        || lower.contains("no address")
    {
        return SshFailure::connection_with_code(
            "dns_failed",
            format!("SSH host could not be resolved. Check the host name or DNS settings. {error}"),
        );
    }

    SshFailure::connection(format!("SSH connection failed. {error}"))
}

fn is_host_key_verification_error(lower: &str) -> bool {
    lower.contains("host key verification")
        || lower.contains("server key verification")
        || lower.contains("hostkey")
        || lower.contains("keychanged")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_key_exchange_failure_as_retryable_connection_error() {
        let failure = classify_connect_error("Key exchange failed".to_string());

        assert_eq!(failure.code, "connection_failed");
        assert!(failure.retryable);
        assert!(!failure.auth_prompt);
    }

    #[test]
    fn classify_key_exchange_init_failure_as_retryable_connection_error() {
        let failure = classify_connect_error("Key exchange init failed".to_string());

        assert_eq!(failure.code, "connection_failed");
        assert!(failure.retryable);
        assert!(!failure.auth_prompt);
    }

    #[test]
    fn classify_unknown_server_key_as_trust_prompt() {
        let failure = classify_connect_error("unknown server key".to_string());

        assert_eq!(failure.code, "host_key_unknown");
        assert!(failure.retryable);
        assert!(!failure.auth_prompt);
    }

    #[test]
    fn classify_changed_host_key_as_blocking_host_key_error() {
        let failure = classify_connect_error("key changed".to_string());

        assert_eq!(failure.code, "host_key_mismatch");
        assert!(!failure.retryable);
        assert!(!failure.auth_prompt);
    }
}
