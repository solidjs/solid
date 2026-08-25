use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    if env::var_os("CARGO_FEATURE_NODE").is_none() {
        return;
    }
    let target = env::var("TARGET").unwrap_or_default();
    if target.contains("wasm32") {
        // napi-build 2.4.1 hard-exports `emnapi_create_env` / `emnapi_delete_env`
        // for emnapi v2 archives. We still ship emnapi 1.x, which does not
        // define those symbols, and rust-lld 1.95+ errors on a missing
        // `--export`. Replicate the WASI setup with `--export-if-defined`.
        setup_wasi_emnapi_v1(&target);
    } else {
        napi_build::setup();
    }
}

fn setup_wasi_emnapi_v1(target: &str) {
    let link_dir = env::var("EMNAPI_LINK_DIR").expect("EMNAPI_LINK_DIR must be set");
    let has_threads = target.ends_with("-threads")
        || matches!(
            target,
            "wasm32-wasi" | "wasm32-wasi-preview1-threads" | "wasm32-wasip1-threads"
        );
    let emnapi_library = if has_threads {
        "emnapi-napi-rs-mt"
    } else {
        "emnapi-basic-napi-rs"
    };
    let emnapi_archive = Path::new(&link_dir).join(format!("lib{emnapi_library}.a"));
    assert!(
        emnapi_archive.is_file(),
        "emnapi archive for {target} is missing at {}",
        emnapi_archive.display()
    );

    println!("cargo:rerun-if-env-changed=EMNAPI_LINK_DIR");
    println!("cargo:rerun-if-env-changed=RUSTC");
    println!("cargo:rerun-if-env-changed=TARGET");
    println!("cargo:rerun-if-env-changed=WASI_SDK_PATH");
    println!("cargo:rustc-link-search={link_dir}");
    println!("cargo:rustc-link-lib=static={emnapi_library}");
    println!("cargo:rustc-link-arg=--export=malloc");
    println!("cargo:rustc-link-arg=--export=free");
    println!("cargo:rustc-link-arg=--export-if-defined=emnapi_create_env");
    println!("cargo:rustc-link-arg=--export-if-defined=emnapi_delete_env");
    println!("cargo:rustc-link-arg=--export=napi_register_wasm_v1");
    println!("cargo:rustc-link-arg=--export-if-defined=napi_prepare_wasm_env_cleanup");
    println!("cargo:rustc-link-arg=--export-if-defined=napi_wasm_env_cleanup_pending");
    println!("cargo:rustc-link-arg=--export-if-defined=node_api_module_get_api_version_v1");
    println!("cargo:rustc-link-arg=--export-table");
    if has_threads {
        println!("cargo:rustc-link-arg=--export-if-defined=emnapi_async_worker_create");
        println!("cargo:rustc-link-arg=--export-if-defined=emnapi_async_worker_init");
    }
    println!("cargo:rustc-link-arg=--export-if-defined=emnapi_thread_crashed");
    println!("cargo:rustc-link-arg=--import-memory");
    println!("cargo:rustc-link-arg=--import-undefined");
    println!("cargo:rustc-link-arg=--max-memory=4294967296");
    println!("cargo:rustc-link-arg=-zstack-size=64000000");
    println!("cargo:rustc-link-arg=--no-check-features");

    let rustc = env::var_os("RUSTC").expect("RUSTC must be set by Cargo");
    let sysroot = rustc_sysroot(&rustc);
    let crt_reactor_path = sysroot
        .join("lib")
        .join("rustlib")
        .join(target)
        .join("lib")
        .join("self-contained")
        .join("crt1-reactor.o");
    assert!(
        crt_reactor_path.is_file(),
        "failed to locate crt1-reactor.o for {target} at {}",
        crt_reactor_path.display()
    );
    println!("cargo:rustc-link-arg={}", crt_reactor_path.display());
    println!("cargo:rustc-link-arg=--export=_initialize");

    if let Ok(wasi_sdk_path) = env::var("WASI_SDK_PATH") {
        let wasi_target = if has_threads {
            "wasm32-wasip1-threads"
        } else {
            "wasm32-wasip1"
        };
        let wasi_lib_dir = Path::new(&wasi_sdk_path)
            .join("share")
            .join("wasi-sysroot")
            .join("lib")
            .join(wasi_target);
        println!("cargo:rustc-link-search=native={}", wasi_lib_dir.display());
        if wasi_lib_dir.join("libsetjmp.a").is_file() {
            println!("cargo:rustc-link-lib=static=setjmp");
        }
    }
}

fn rustc_sysroot(rustc: &std::ffi::OsStr) -> PathBuf {
    let output = Command::new(rustc)
        .args(["--print", "sysroot"])
        .output()
        .unwrap_or_else(|err| panic!("failed to execute rustc --print sysroot: {err}"));
    assert!(
        output.status.success(),
        "rustc --print sysroot failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    PathBuf::from(
        String::from_utf8(output.stdout)
            .expect("sysroot utf8")
            .trim(),
    )
}
