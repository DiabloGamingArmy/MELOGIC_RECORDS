use std::{env, path::PathBuf};

fn main() {
  #[cfg(target_os = "macos")]
  {
    let home = env::var("HOME").expect("HOME is required to locate the cached VST3 SDK");
    let sdk = PathBuf::from(home).join("Library/Caches/Melogic/vst3sdk");
    if !sdk.join("CMakeLists.txt").exists() {
      panic!("Steinberg VST3 SDK cache is missing at {}. Re-run the Soura native VST3 host installer.", sdk.display());
    }

    let mut config = cmake::Config::new("native-vst3-host");
    config
      .define("VST3_SDK_ROOT", &sdk)
      .define("CMAKE_BUILD_TYPE", "Release")
      .define("CMAKE_OSX_DEPLOYMENT_TARGET", "11.0");

    let dst = config.build();
    let installed_lib = dst.join("lib");
    let sdk_build_lib = dst.join("build/lib/Release");

    println!("cargo:rustc-link-search=native={}", installed_lib.display());
    println!("cargo:rustc-link-search=native={}", sdk_build_lib.display());

    let soura_host = installed_lib.join("libsoura_native_vst3_host.a");
    if !soura_host.exists() {
      panic!("Required Soura VST3 host archive was not produced: {}", soura_host.display());
    }

    // Soura's bridge now contains the platform Module::create and PlugProvider
    // implementations directly, so force-loading this single archive is safe.
    println!("cargo:rustc-link-arg=-Wl,-force_load,{}", soura_host.display());

    // Remaining Steinberg support archives are linked once as normal archives.
    // Do not force-load sdk/sdk_hosting: both contain vstinitiids.cpp and doing
    // so creates duplicate IID symbols on Apple ld.
    let steinberg_archives = [
      sdk_build_lib.join("libsdk_hosting.a"),
      sdk_build_lib.join("libsdk.a"),
      sdk_build_lib.join("libsdk_common.a"),
      sdk_build_lib.join("libpluginterfaces.a"),
      sdk_build_lib.join("libbase.a"),
    ];
    for archive in &steinberg_archives {
      if !archive.exists() {
        panic!("Required Steinberg VST3 archive was not produced: {}", archive.display());
      }
      println!("cargo:rustc-link-arg={}", archive.display());
    }

    println!("cargo:rustc-link-lib=c++");
    println!("cargo:rustc-link-lib=framework=Cocoa");
    println!("cargo:rustc-link-lib=framework=Foundation");

    println!("cargo:rerun-if-changed=native-vst3-host/CMakeLists.txt");
    println!("cargo:rerun-if-changed=native-vst3-host/soura_vst3_host.mm");
  }

  tauri_build::build()
}
