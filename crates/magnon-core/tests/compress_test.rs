use magnon_core::{compress_brotli, compress_directory, compress_gzip, CompressOptions};
use std::fs;

#[test]
fn test_gzip_compression() {
    let input = b"function helloWorld() { return 'hello world, this is a large test string for gzip!'; }".repeat(50);
    let compressed = compress_gzip(&input, 6).expect("gzip compression should succeed");
    assert!(compressed.len() < input.len());
    assert_eq!(compressed[0], 0x1f);
    assert_eq!(compressed[1], 0x8b);
}

#[test]
fn test_brotli_compression() {
    let input = b"const data = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: 'user_' + i }));".repeat(20);
    let compressed = compress_brotli(&input, 5).expect("brotli compression should succeed");
    assert!(compressed.len() < input.len());
}

#[test]
fn test_batch_directory_compression() {
    let tmp = std::env::temp_dir().join("magnon_compress_test");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();

    let file1 = tmp.join("bundle.js");
    let file2 = tmp.join("style.css");
    let file3 = tmp.join("small.txt");

    fs::write(&file1, "console.log('test');\n".repeat(200)).unwrap();
    fs::write(&file2, ".class { color: red; }\n".repeat(200)).unwrap();
    fs::write(&file3, "tiny").unwrap();

    let options = CompressOptions {
        threshold: 100,
        ..Default::default()
    };

    let result = compress_directory(&tmp, &options);
    assert_eq!(result.total_files, 3);
    assert!(tmp.join("bundle.js.gz").exists());
    assert!(tmp.join("bundle.js.br").exists());
    assert!(tmp.join("style.css.gz").exists());
    assert!(tmp.join("style.css.br").exists());
    assert!(!tmp.join("small.txt.gz").exists());

    let _ = fs::remove_dir_all(&tmp);
}
