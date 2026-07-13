fn main() {
    prepare_rdp_sidecar_external_bin();
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
    let sidecar_binary = sidecar_target_dir
        .join("debug")
        .join(sidecar_binary_name);
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
