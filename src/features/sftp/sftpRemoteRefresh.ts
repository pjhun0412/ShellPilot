const sftpRemoteRefreshEventName = 'shellpilot:sftp-remote-refresh';

interface SftpRemoteRefreshDetail {
  remoteIdentity: string;
}

export function requestSftpRemoteRefresh(remoteIdentity: string) {
  window.dispatchEvent(new CustomEvent<SftpRemoteRefreshDetail>(sftpRemoteRefreshEventName, {
    detail: { remoteIdentity },
  }));
}

export function subscribeSftpRemoteRefreshRequest(
  listener: (detail: SftpRemoteRefreshDetail) => void,
) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SftpRemoteRefreshDetail>).detail);
  };

  window.addEventListener(sftpRemoteRefreshEventName, handler);

  return () => {
    window.removeEventListener(sftpRemoteRefreshEventName, handler);
  };
}
