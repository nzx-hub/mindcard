use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageEntry {
    pub key: String,
    pub value: String,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join("storage");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{e}"))?;
    Ok(dir)
}

fn valid_key(key: &str) -> bool {
    key.starts_with("mindcard:")
        && key.len() <= 512
        && !key.contains('\0')
        && !key.contains('\r')
        && !key.contains('\n')
}

fn encode_key(key: &str) -> String {
    let mut out = String::with_capacity(key.len() * 2);
    for b in key.as_bytes() {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn decode_key(name: &str) -> Option<String> {
    if name.len() % 2 != 0 {
        return None;
    }
    let mut bytes = Vec::with_capacity(name.len() / 2);
    for i in (0..name.len()).step_by(2) {
        bytes.push(u8::from_str_radix(&name[i..i + 2], 16).ok()?);
    }
    String::from_utf8(bytes).ok()
}

fn key_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    if !valid_key(key) {
        return Err("拒绝非 MindCard 存储键".into());
    }
    Ok(root(app)?.join(format!("{}.json", encode_key(key))))
}

#[tauri::command]
pub fn storage_load(app: AppHandle) -> Result<Vec<StorageEntry>, String> {
    let dir = root(&app)?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("无法读取数据目录：{e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(key) = decode_key(stem) else {
            continue;
        };
        if !valid_key(&key) {
            continue;
        }
        if let Ok(value) = fs::read_to_string(&path) {
            out.push(StorageEntry { key, value });
        }
    }

    out.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(out)
}

#[tauri::command]
pub fn storage_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let path = key_path(&app, &key)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, value).map_err(|e| format!("写入失败：{e}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("替换旧文件失败：{e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("提交文件失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub fn storage_remove(app: AppHandle, key: String) -> Result<(), String> {
    let path = key_path(&app, &key)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除失败：{e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_roundtrip_is_safe() {
        let key = "mindcard:deck:my-deck";
        let file = encode_key(key);
        assert_eq!(decode_key(&file).as_deref(), Some(key));
        assert!(valid_key(key));
        assert!(!valid_key("other:deck"));
        assert!(!valid_key("mindcard:bad\nkey"));
    }
}