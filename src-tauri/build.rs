fn main() {
    prepare_rdp_sidecar_external_bin();
    prepare_vnc_sidecar_external_bin();
    tauri_build::build();
}

fn prepare_rdp_sidecar_external_bin() {
    let Ok(target) = std::env::var("TARGET") else {
        return;
    };
    let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") else {
        return;
    };

    let manifest_dir = std::path::PathBuf::from(manifest_dir);
    let sidecar_manifest = manifest_dir.join("rdp-sidecar").join("Cargo.toml");
    let sidecar_target_dir = manifest_dir.join("rdp-sidecar").join("target");
    let sidecar_binary_name = if target.contains("windows") {
        "shellpilot-rdp-probe.exe"
    } else {
        "shellpilot-rdp-probe"
    };
    let sidecar_binary = sidecar_target_dir.join("debug").join(sidecar_binary_name);
    let external_bin_dir = manifest_dir.join("binaries");
    let external_bin_name = if target.contains("windows") {
        format!("shellpilot-rdp-probe-{target}.exe")
    } else {
        format!("shellpilot-rdp-probe-{target}")
    };
    let external_bin = external_bin_dir.join(external_bin_name);

    println!("cargo:rerun-if-changed={}", sidecar_manifest.display());
    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("rdp-sidecar").join("src").display()
    );

    if external_bin.exists() && !is_vnc_sidecar_source_newer(&sidecar_manifest, &external_bin) {
        return;
    }

    let status = std::process::Command::new("cargo")
        .arg("build")
        .arg("--manifest-path")
        .arg(&sidecar_manifest)
        .status();

    match status {
        Ok(status) if status.success() => {}
        Ok(status) => {
            panic!("failed to build RDP sidecar for {target}: cargo exited with {status}");
        }
        Err(error) => {
            panic!("failed to run cargo for RDP sidecar: {error}");
        }
    }

    if let Err(error) = std::fs::create_dir_all(&external_bin_dir) {
        panic!("failed to create sidecar external bin directory: {error}");
    }

    if let Err(error) = std::fs::copy(&sidecar_binary, &external_bin) {
        panic!(
            "failed to copy RDP sidecar from {} to {}: {error}",
            sidecar_binary.display(),
            external_bin.display()
        );
    }
}

fn prepare_vnc_sidecar_external_bin() {
    let Ok(target) = std::env::var("TARGET") else {
        return;
    };
    let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") else {
        return;
    };

    let manifest_dir = std::path::PathBuf::from(manifest_dir);
    let sidecar_manifest = manifest_dir.join("vnc-sidecar").join("Cargo.toml");
    let sidecar_target_dir = manifest_dir.join("vnc-sidecar").join("target");
    let sidecar_binary_name = if target.contains("windows") {
        "shellpilot-vnc-probe.exe"
    } else {
        "shellpilot-vnc-probe"
    };
    let sidecar_binary = sidecar_target_dir.join("debug").join(sidecar_binary_name);
    let external_bin_dir = manifest_dir.join("binaries");
    let external_bin_name = if target.contains("windows") {
        format!("shellpilot-vnc-probe-{target}.exe")
    } else {
        format!("shellpilot-vnc-probe-{target}")
    };
    let external_bin = external_bin_dir.join(external_bin_name);

    println!("cargo:rerun-if-changed={}", sidecar_manifest.display());
    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("vnc-sidecar").join("src").display()
    );

    if external_bin.exists() {
        return;
    }

    let status = std::process::Command::new("cargo")
        .arg("build")
        .arg("--manifest-path")
        .arg(&sidecar_manifest)
        .status();

    match status {
        Ok(status) if status.success() => {}
        Ok(status) => {
            panic!("failed to build VNC sidecar for {target}: cargo exited with {status}");
        }
        Err(error) => {
            panic!("failed to run cargo for VNC sidecar: {error}");
        }
    }

    if let Err(error) = std::fs::create_dir_all(&external_bin_dir) {
        panic!("failed to create sidecar external bin directory: {error}");
    }

    if let Err(error) = std::fs::copy(&sidecar_binary, &external_bin) {
        panic!(
            "failed to copy VNC sidecar from {} to {}: {error}",
            sidecar_binary.display(),
            external_bin.display()
        );
    }
}

fn is_vnc_sidecar_source_newer(
    manifest_path: &std::path::Path,
    binary_path: &std::path::Path,
) -> bool {
    let Ok(binary_modified) =
        std::fs::metadata(binary_path).and_then(|metadata| metadata.modified())
    else {
        return true;
    };
    let Some(sidecar_dir) = manifest_path.parent() else {
        return true;
    };
    let mut source_paths = vec![manifest_path.to_path_buf(), sidecar_dir.join("Cargo.lock")];

    if let Ok(entries) = std::fs::read_dir(sidecar_dir.join("src")) {
        source_paths.extend(
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|extension| extension == "rs")),
        );
    } else {
        return true;
    }

    source_paths.iter().any(|source_path| {
        std::fs::metadata(source_path)
            .and_then(|metadata| metadata.modified())
            .map(|modified| modified > binary_modified)
            .unwrap_or(true)
    })
}
