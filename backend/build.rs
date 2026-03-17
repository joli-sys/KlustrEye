fn main() {
    // Force recompilation when frontend dist/ changes so rust-embed picks up new assets
    println!("cargo:rerun-if-changed=../dist");
}
