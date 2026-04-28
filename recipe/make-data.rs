use std::fs;
use std::io;
use std::collections::HashSet;
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures::future::join_all;
use image::{DynamicImage, ImageReader, ImageFormat};
use pinyin::ToPinyin;
use serde::{Deserialize, Serialize};

// cargo run --bin recipe

// now you need some native library to process the images,
// while nodejs is not suitable for this kind of work, so try rust to
// - download images, process images into shrinked data url
// - identity bottle and liquid items (hardcode actually), create bottle x liquid items
// - add pinyin to item names
// - for now, connect to original make data logic

#[derive(Debug, Deserialize)]
struct RawItem {
    name: String,
    icon: String,
    desc1: String,
    desc2: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct LocalItem {
    name: String,
    pinyin: String,
    icon: String,
    desc: (String, String),
}

async fn process_item(item: RawItem) -> Result<LocalItem, String> {

    if !item.icon.starts_with("url(\"https://") || !item.icon.ends_with(".png\")") {
        return Err(format!("{}: unknown icon format: {}", item.name, item.icon));
    }

    let url = &item.icon[5..item.icon.len() - 2];
    let image_data = reqwest::get(url).await
        .map_err(|e| format!("{}: failed to download image: {}", item.name, e))?
        .bytes().await
        .map_err(|e| format!("{}: failed to get image bytes: {}", item.name, e))?;

    let full_image = ImageReader
        ::with_format(io::Cursor::new(image_data), ImageFormat::Png)
        .decode().map_err(|e| format!("{}: failed to decode image: {}", item.name, e))?;
    // make sure is rgba8 color
    let full_image = DynamicImage::ImageRgba8(full_image.to_rgba8());
    // validate dimentions
    if full_image.width() != 396 || full_image.height() != 396 {
        return Err(format!("{} has dimensions {}x{}, expected 396x396", item.name, full_image.width(), full_image.height()));
    }
    
    let small_image = full_image.resize(64, 64, image::imageops::FilterType::Lanczos3);
    let mut image_data_avif: Vec<u8> = Vec::new();
    small_image
        .write_to(&mut io::Cursor::new(&mut image_data_avif), ImageFormat::Avif)
        .map_err(|e| format!("{}: failed to encode as AVIF: {}", item.name, e))?;
    let data_uri = format!("data:image/avif;base64,{}", STANDARD.encode(image_data_avif));
    
    // why are you so inconvenient to skip non pinyin-able characters?
    let pinyin = item.name.chars().fold(String::new(), |mut acc, c| match c.to_pinyin() {
        Some(p) => { acc.push_str(p.plain()); acc }
        None => { acc.push(c); acc }
    });

    println!("{}({}): {}", item.name, pinyin, data_uri);
    Ok(LocalItem {
        name: item.name,
        pinyin,
        icon: data_uri,
        desc: (item.desc1, item.desc2),
    })
}

async fn make_items_with_icon() -> Result<()> {

    let raw_original_content = fs::read_to_string("data/items-raw.json")?;
    let raw_items: Vec<RawItem> = serde_json::from_str(&raw_original_content)?;
    println!("raw items {}", raw_items.len());

    let existing_items: Vec<LocalItem> = if let Ok(content) = fs::read_to_string("data/items-icon.json") {
        serde_json::from_str::<Vec<LocalItem>>(&content)?
    } else {
        Vec::new()
    };
    if !existing_items.is_empty() { println!("existing items {}", existing_items.len()); }
    let existing_item_names = existing_items.iter().map(|i| i.name.as_str()).collect::<HashSet<_>>();
    
    let tasks = raw_items.into_iter()
        .filter(|item| !existing_item_names.contains(&item.name.as_str()))
        .map(|item| tokio::spawn(async move { process_item(item).await })).collect::<Vec<_>>();
    if tasks.is_empty() {
        println!("no new items, skip");
        return Ok(());
    }

    // parallel run
    let results = join_all(tasks).await;

    let mut new_items = Vec::new();
    for result in results {
        match result {
            Ok(Ok(item)) => new_items.push(item),
            Ok(Err(process_error)) => eprintln!("{}", process_error),
            Err(join_error) => eprintln!("✗ Task panicked: {}", join_error),
        }
    }
    println!("new items {}", new_items.len());

    let mut all_items = existing_items;
    all_items.extend(new_items);
    fs::write("data/items-icon.json", serde_json::to_string_pretty(&all_items)?)?;

    Ok(())
}

#[derive(Debug, Serialize)]
struct KindedItem {
    name: String,
    pinyin: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    icon: String,
    desc: (String, String),
}
const LIQUID_ITEM_NAMES: &[&str] = &[
    // these are ordered top in wiki in game in industry production category
    "锦草溶液",
    "芽针溶液",
    "液化息壤",
    "液化重息壤",
    "壤晶废液",
    "惰性壤晶废液",
    "赤铜溶液",
    "赫铜溶液",
    "污水",
    // these are natural resource
    "清水",
    "沉积酸",
];
const BOTTLE_ITEM_NAMES: &[&str] = &[
    // these are ordered together in wiki in game in industry production category
    "紫晶质瓶",
    "蓝铁瓶",
    "高晶质瓶",
    "钢质瓶",
    "赤铜瓶",
    "赫铜瓶",
];
fn make_items_with_kind() -> Result<()> {

    let new_original_content = fs::read_to_string("data/items-icon.json")?;
    let local_items: Vec<LocalItem> = serde_json::from_str(&new_original_content)?;
    let mut new_items = local_items.into_iter().map(|i| KindedItem {
        name: i.name,
        pinyin: i.pinyin,
        kind: None,
        icon: i.icon,
        desc: i.desc,
    }).collect::<Vec<_>>();

    for item in &mut new_items {
        if item.name.ends_with("种子") {
            item.kind = Some("seed");
        }
    }

    for &bottle_item_name in BOTTLE_ITEM_NAMES {
        if let Some(bottle_item) = new_items.iter_mut().find(|i| i.name == bottle_item_name) {
            bottle_item.kind = Some("bottle");
        } else {
            println!("configured bottle item not found in items: {}", bottle_item_name);
        };
    }
    for &liquid_item_name in LIQUID_ITEM_NAMES {
        if let Some(liquid_item) = new_items.iter_mut().find(|i| i.name == liquid_item_name) {
            liquid_item.kind = Some("liquid");
        } else {
            println!("configured liquid item not found in items: {}", liquid_item_name);
        };
    }

    for &bottle_item_name in BOTTLE_ITEM_NAMES {
        let Some(bottle_item) = new_items.iter().find(|i| i.name == bottle_item_name) else { continue };
        if !bottle_item.icon.starts_with("data:image/avif;base64,") {
            println!("bottle {} icon not starts with data uri? {}", bottle_item.name, bottle_item.icon);
            continue;
        }
        let bottle_icon_data = STANDARD.decode(&bottle_item.icon[23..])?;
        let bottle_icon = ImageReader::with_format(io::Cursor::new(bottle_icon_data), ImageFormat::Avif).decode()?;

        for &liquid_item_name in LIQUID_ITEM_NAMES {
            // by the way, if you want to avoid duplicate work of these and want some parallel, image operations should use rayon not futures
            let Some(liquid_item) = new_items.iter().find(|i| i.name == liquid_item_name) else { continue };

            let liquid_icon_data = STANDARD.decode(&liquid_item.icon[23..])?;
            let liquid_icon = ImageReader::with_format(io::Cursor::new(liquid_icon_data), ImageFormat::Avif).decode()?;
            let liquid_icon = liquid_icon.resize(32, 32, image::imageops::FilterType::Lanczos3);
        
            let mut filled_icon = bottle_icon.clone();
            image::imageops::overlay(&mut filled_icon, &liquid_icon, 16, 16); // this is not try?
            let mut filled_icon_data: Vec<u8> = Vec::new();
            filled_icon.write_to(&mut io::Cursor::new(&mut filled_icon_data), ImageFormat::Avif)?;
            let data_uri = format!("data:image/avif;base64,{}", STANDARD.encode(filled_icon_data));
            
            let filled_name = format!("{} ({})", bottle_item_name, liquid_item_name);
            new_items.push(KindedItem {
                pinyin: filled_name.chars().fold(String::new(), |mut acc, c| match c.to_pinyin() {
                    Some(p) => { acc.push_str(p.plain()); acc }
                    None => { acc.push(c); acc }
                }),
                name: filled_name,
                icon: data_uri,
                kind: Some("filled"),
                desc: (
                    format!("装有{}的{}。", liquid_item_name, bottle_item_name),
                    format!("我问你为什么装有液体的瓶子和原来的瓶子是一个名字，他妈的连描述信息也是一样的？"),
                ),
            });
        }
    }

    fs::write("data/items-kind.json", serde_json::to_string_pretty(&new_items)?)?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {

    if std::env::args().any(|v| v == "icon") {
        make_items_with_icon().await?;
    } else if std::env::args().any(|v| v == "kind") {
        make_items_with_kind()?;
    } else {
        println!("USAGE: icon or kind");
    }

    Ok(())
}
