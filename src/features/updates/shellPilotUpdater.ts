import { message, ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';

interface CheckForShellPilotUpdateOptions {
  source: 'manual' | 'startup';
}

export async function checkForShellPilotUpdate({ source }: CheckForShellPilotUpdateOptions) {
  if (source === 'startup' && isDevelopmentRuntime()) {
    return;
  }

  try {
    const update = await check({ timeout: 15000 });

    if (!update) {
      if (source === 'manual') {
        await message('현재 설치된 ShellPilot이 최신 버전입니다.', {
          kind: 'info',
          title: 'ShellPilot 업데이트',
        });
      }
      return;
    }

    const releaseNotes = typeof update.body === 'string' && update.body.trim().length > 0
      ? `\n\n릴리즈 노트:\n${update.body.trim()}`
      : '';
    const shouldUpdate = await ask(
      [
        `새 ShellPilot 버전이 있습니다.`,
        '',
        `현재 버전: ${update.currentVersion}`,
        `새 버전: ${update.version}`,
        releaseNotes,
        '',
        '지금 다운로드하고 설치할까요?',
      ].join('\n'),
      {
        kind: 'info',
        title: 'ShellPilot 업데이트',
      },
    );

    if (!shouldUpdate) {
      return;
    }

    let downloadedBytes = 0;
    let contentLength: number | undefined;

    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === 'Started') {
        downloadedBytes = 0;
        contentLength = event.data.contentLength;
        return;
      }

      if (event.event === 'Progress') {
        downloadedBytes += event.data.chunkLength;
      }
    });

    const downloadedSummary = contentLength
      ? `\n\n다운로드: ${formatBytes(downloadedBytes)} / ${formatBytes(contentLength)}`
      : '';
    const shouldRelaunch = await ask(
      `업데이트 설치가 완료되었습니다.${downloadedSummary}\n\nShellPilot을 다시 시작할까요?`,
      {
        kind: 'info',
        title: 'ShellPilot 업데이트 완료',
      },
    );

    if (shouldRelaunch) {
      await relaunch();
    }
  } catch (error) {
    console.warn('failed to check ShellPilot updates', error);

    if (source === 'manual') {
      await message(formatUpdateError(error), {
        kind: 'error',
        title: 'ShellPilot 업데이트 확인 실패',
      });
    }
  }
}

function isDevelopmentRuntime() {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let nextValue = value;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatUpdateError(error: unknown) {
  const messageText = error instanceof Error ? error.message : String(error);

  return [
    '업데이트 정보를 확인하지 못했습니다.',
    '',
    'GitHub Releases 업데이트 endpoint, 서명 공개키, 네트워크 상태를 확인하세요.',
    '',
    messageText,
  ].join('\n');
}
