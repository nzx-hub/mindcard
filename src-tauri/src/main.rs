#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;

use std::path::PathBuf;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            storage::storage_load,
            storage::storage_set,
            storage::storage_remove
        ])
        .setup(|app| {
            let data_dir = match std::env::var("MINDCARD_DATA_DIR") {
                Ok(v) => PathBuf::from(v),
                Err(_) => app.path().app_local_data_dir()?,
            };
            std::fs::create_dir_all(&data_dir)?;

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("MindCard · 忆卡")
                .inner_size(1200.0, 820.0)
                .min_inner_size(920.0, 620.0)
                .data_directory(data_dir)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MindCard");
}