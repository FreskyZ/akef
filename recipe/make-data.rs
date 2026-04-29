use std::fs;
use std::io;
use std::collections::HashSet;
use anyhow::Result;
use futures::future::join_all;
use image::{DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};

// read item.json,
// if icon is url, download, shrink size
// if icon is coordinate, create a view from decoded input item image,
// if icon is coordinate, put it in the same coordinate in output item image,
// if icon was url, assign next available coordinate and put it in output item image
// create bottle x liquid item if not exist, create icon by overlay and assign coordinate

#[derive(Debug, Deserialize, Serialize)]
struct Item {
    name: String,
    icon: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    version: usize,
    desc: String,
}

async fn download_image(item: &Item) -> Result<(&Item, DynamicImage)> {
    let large_image_data = reqwest::get(&item.icon).await?.bytes().await?;
    let large_image = image::ImageReader::with_format(
        io::Cursor::new(large_image_data), image::ImageFormat::Png).decode()?;

    // make sure is rgba8 color, old code is doing this, not sure whether it is needed for now
    let large_image = if matches!(large_image, DynamicImage::ImageRgba8(..)) {
        large_image
    } else {
        println!("item {} image is not rgba8 but {:?}", item.name, large_image.color());
        DynamicImage::ImageRgba8(large_image.to_rgba8())
    };
    // validate dimentions
    if large_image.width() != 396 || large_image.height() != 396 {
        println!("item {} image is not 396x396 but {}x{}?", item.name, large_image.width(), large_image.height());
    }
    // resize, and the work is done here
    let small_image = large_image.resize(64, 64, image::imageops::FilterType::Lanczos3);
    Ok((item, small_image))
}

async fn make_items_with_icon(input_filename: &str, output_filename: &str) -> Result<()> {

    let data_filename = format!("data/{}.json", input_filename);
    println!("read {}", data_filename);
    let original_content = fs::read_to_string(data_filename)?;
    let mut items: Vec<Item> = serde_json::from_str(&original_content)?;
    println!("items count {}", items.len());

    // borrow checker think the reference to items is send to tokio::spawn and may live
    // very long exceeds lifetime of this function, so you cannot mutable borrow items here,
    // and according to 10 years experience fighting with rustc, the answer is like this,
    // UPDATE: after ask ai, the common answer is clone or arc, and the most correct answer is still this
    // UPDATE: you can consume split (drain) the vector into 2 halfs according to condition,
    // and consume the item and return the item in the async function, but I should not allow
    // borrow checker to raise issue in this can-not-be-more-simple-even-immutable-promise.all-operation
    let unsound_items: Vec<Item> = Vec::new();
    unsafe { std::ptr::copy_nonoverlapping(&items as *const _, &unsound_items as *const _ as *mut _, 1) }
    let unsound_slice = unsound_items.leak::<'static>();

    // 1. collect items to download image
    // check start with https and ends with .png (will they change this?)
    let download_tasks = unsound_slice.iter()
        .filter(|item| item.icon.starts_with("https://") && item.icon.ends_with(".png"))
        .map(|item| tokio::spawn(download_image(item))).collect::<Vec<_>>();
    let download_task_count = download_tasks.len();
    println!("download tasks {}", download_task_count);

    let mut new_images = Vec::new(); // (&item, dynamicimage)[]
    let download_results = join_all(download_tasks).await;
    for result in download_results {
        match result {
            Ok(Ok(r)) => new_images.push(r),
            Ok(Err(e)) => println!("{}", e),
            Err(e) => println!("future join error {}", e),
        }
    }
    if new_images.len() != download_task_count {
        anyhow::bail!("abort because some of the files failed to download");
    }

    // 2. create view for existing items
    // create view should take no time compared to download so no async or rayon
    let image_filename = format!("data/{}.png", input_filename);
    println!("decode {}", image_filename);
    let input_item_image = image::open(image_filename)?;

    let mut existing_images_ok = true;
    let mut existing_images = Vec::new(); // (&item, row, column, subimage)
    for item in items.iter().filter(|item| !item.icon.starts_with("https://") || !item.icon.ends_with(".png")) {
        let Some((Ok(row), Ok(column))) = item.icon.split_once(',').map(|(r, c)| (r.parse::<usize>(), c.parse::<usize>())) else {
            existing_images_ok = false;
            println!("item {} icon does not look like url but also not look like coordinate? {}", item.name, item.icon);
            continue;
        };
        if (row + 1) * 64 > input_item_image.height() as usize || (column + 1) * 64 > input_item_image.width() as usize {
            existing_images_ok = false;
            println!("item {} icon position {},{} exceeds input image dimension {},{}",
                item.name, row, column, input_item_image.height(), input_item_image.width());
            continue;
        }
        let sub_image = input_item_image.view(/* x */ column as u32 * 64, /* y */ row as u32 * 64, /* w */ 64, /* h */ 64);
        existing_images.push((item, (row, column), sub_image));
    }
    println!("existing images {}", existing_images.len());
    if !existing_images_ok {
        anyhow::bail!("abort because some of the items failed to load subimage");
    }

    // 3. create filled items
    let mut new_filled_items = Vec::new(); // (Item, &bottle, &liquid)
    for bottle_item in items.iter().filter(|item| item.kind.as_deref() == Some("bottle")) {
        for liquid_item in items.iter().filter(|item| item.kind.as_deref() == Some("liquid")) {
            let filled_item_name = format!("{} ({})", bottle_item.name, liquid_item.name);
            if !items.iter().any(|e| e.name == filled_item_name) {
                new_filled_items.push((Item {
                    name: filled_item_name,
                    icon: String::new(),
                    kind: Some("filled".to_string()),
                    version: std::cmp::max(bottle_item.version, liquid_item.version),
                    desc: format!("装有{}的{}。+我问你为什么装有液体的瓶子和原来的瓶子是一个名字，他妈的连描述信息也是一样的？", liquid_item.name, bottle_item.name),
                }, bottle_item, liquid_item));
            }
        }
    }
    new_filled_items.sort_by(|i1, i2| i1.0.name.cmp(&i2.0.name));
    println!("new filled items {}", new_filled_items.len());

    // 4. assign coordinates to downloaded images and newly created image
    let mut existing_coordinates = existing_images.iter().map(|&(_, coordinate, _)| coordinate).collect::<HashSet<_>>();
    if existing_coordinates.len() != existing_images.len() {
        anyhow::bail!("duplicate coordinates in existing data, when will that happen? lazy to find which is duplicating because I think that will not happen(");
    }
    let mut layout_iter = LayoutIter{ next: (0, 0) };
    let mut new_item_coordinates = Vec::new(); // (cloned item name, coordinate)[], for both downloaded and new filled
    for (item, _) in &new_images {
        let mut next_coordinate = layout_iter.next().unwrap(); // unwrap: this iterator does not end
        while existing_coordinates.contains(&next_coordinate) { next_coordinate = layout_iter.next().unwrap(); }
        existing_coordinates.insert(next_coordinate);
        new_item_coordinates.push((item.name.clone(), next_coordinate));
    }
    for (item, ..) in &new_filled_items {
        let mut next_coordinate = layout_iter.next().unwrap();
        while existing_coordinates.contains(&next_coordinate) { next_coordinate = layout_iter.next().unwrap(); }
        existing_coordinates.insert(next_coordinate);
        new_item_coordinates.push((item.name.clone(), next_coordinate));
    }

    // 5. copy them into output image
    let total_item_count = items.len() + new_filled_items.len();
    // grid width is always the minimum square size to hold this many items
    let grid_width = (1..).find(|i| i * i >= total_item_count).unwrap();
    // grid height may be less if the last row is not filled (item count reaches (n-1)^2, but does not reach (n-1)^2+n-1)
    let grid_height = if grid_width * (grid_width - 1) >= total_item_count { grid_width - 1 } else { grid_width };
    // // by the way, the result image is currently abount 160kb, for comparison, the previous separated data uri approach uses >500kb
    let mut output_item_image = image::RgbaImage::new(grid_width as u32 * 64, grid_height as u32 * 64);
    println!("output image size {}x{}", output_item_image.width(), output_item_image.height());

    for (_, (row, column), image_view) in &existing_images {
        // &**: first *: from for-in&, second *: SubImage as Deref returns SubImageInner, &: overlay expects a reference to GenericImageView
        image::imageops::overlay(&mut output_item_image, &**image_view, /* x */ *column as i64 * 64, /* y */ *row as i64 * 64);
    }
    // this image is owning DynamicImage compare to previous array
    for (item, image) in &new_images {
        let &(_, (row, column)) = new_item_coordinates.iter().find(|(n, ..)| n == &item.name).unwrap();
        println!("item {} assign coordinate {},{}", item.name, row, column);
        image::imageops::overlay(&mut output_item_image, image, /* x */ column as i64 * 64, /* y */ row as i64 * 64);
    }
    // this item is owning Item compare to previous arrays
    for (item, bottle_item, liquid_item) in &new_filled_items {
        let &(_, (row, column)) = new_item_coordinates.iter().find(|(n, ..)| n == &item.name).unwrap();
        println!("item {} assign coordinate {},{}", item.name, row, column);
        // copy bottle item into output image
        if let Some((_, _, image_view)) = existing_images.iter().find(|(item, ..)| item.name == bottle_item.name) {
            image::imageops::overlay(&mut output_item_image, &**image_view, /* x */ column as i64 * 64, /* y */ row as i64 * 64);
        } else if let Some((_, image)) = new_images.iter().find(|(item, ..)| item.name == bottle_item.name) {
            image::imageops::overlay(&mut output_item_image, image, /* x */ column as i64 * 64, /* y */ row as i64 * 64);
        } else {
            anyhow::bail!("why is item {}'s bottle item {} not existing in both new images and existing images?", item.name, bottle_item.name)
        }
        // find liquid item, shrink it and copy into output image
        if let Some((_, _, image_view)) = existing_images.iter().find(|(item, ..)| item.name == liquid_item.name) {
            let owned_image = DynamicImage::ImageRgba8(image_view.to_image());
            image::imageops::overlay(
                &mut output_item_image,
                &owned_image.resize(32, 32, image::imageops::FilterType::Lanczos3),
                /* x */ column as i64 * 64 + 16,
                /* y */ row as i64 * 64 + 16);
        } else if let Some((_, image)) = new_images.iter().find(|(item, ..)| item.name == liquid_item.name) {
            image::imageops::overlay(
                &mut output_item_image,
                &image.resize(32, 32, image::imageops::FilterType::Lanczos3),
                /* x */ column as i64 * 64 + 16,
                /* y */ row as i64 * 64 + 16);
        } else {
            anyhow::bail!("why is item {}'s liquid item {} not existing in both new images and existing images?", item.name, liquid_item.name)
        }
    }

    let new_filled_items = new_filled_items.into_iter().map(|(item, ..)| item).collect::<Vec<_>>();
    items.extend(new_filled_items);
    // why is this lifetime error?
    // items.sort_by_key(|item| (-(item.version as isize), item.name.as_str()));
    // version desc, filled last, then by name asc
    items.sort_by(|i1, i2| i2.version.cmp(&i1.version).then(match (&i1.kind, &i2.kind) {
        (Some(k1), Some(k2)) if k1 == "filled" && k2 == "filled" => std::cmp::Ordering::Equal,
        (Some(k1), _) if k1 == "filled" => std::cmp::Ordering::Greater,
        (_, Some(k2)) if k2 == "filled" => std::cmp::Ordering::Less,
        _ => std::cmp::Ordering::Equal,
    }).then(i1.name.cmp(&i2.name)));

    for item in &mut items {
        let Some((_, (row, column))) = new_item_coordinates.iter().find(|(n, _)| n == &item.name) else { continue };
        item.icon = format!("{},{}", row, column);
    }

    println!("writing data/{n}.json, data/{n}.png and data/{n}.avif", n=output_filename);
    output_item_image.save(format!("data/{}.png", output_filename))?;
    output_item_image.save(format!("data/{}.avif", output_filename))?;
    fs::write(format!("data/{}.json", output_filename), serde_json::to_string_pretty(&items)?)?;

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {

    let args = std::env::args().collect::<Vec<_>>();
    if args.len() == 2 {
        make_items_with_icon(&args[1], &args[1]).await?;
    } else if args.len() == 3 {
        make_items_with_icon(&args[1], &args[2]).await?;
    } else {
        println!("USAGE: make-icon INPUTNAME [OUTPUTNAME]");
    }
    Ok(())
}

struct LayoutIter {
    // next coordinate (row, column)
    // row start from top start from 0, column start from left start from 0
    // // use next not last because you have no easy way to represent initial state
    next: (usize, usize),
}
impl Iterator for LayoutIter {
    type Item = (usize, usize);

    fn next(&mut self) -> Option<Self::Item> {
        let prev = self.next;
        // special case at both bottom and right side, need to switch to next right side
        if prev.0 == prev.1 {
            self.next = (0, prev.1 + 1);
        // special case at bottom of right side, need to switch to bottom side
        } else if prev.0 + 1 == prev.1 {
            self.next = (prev.0 + 1, 0);
        // if coordinate is at right side, increase row
        } else if prev.1 > prev.0 {
            self.next = (prev.0 + 1, prev.1);
        // if coordinate is at bottom side, increase column
        } else {
            self.next = (prev.0, prev.1 + 1);
        }
        Some(prev)
    }
}
#[cfg(test)]
#[test]
fn test_layout_iter() {
    let iter = LayoutIter{ next: (0, 0) };
    assert_eq!(iter.take(16).collect::<Vec<_>>(), vec![
        (0, 0),
        (0, 1), /* <right, bottom> */ (1, 0), (1, 1),
        (0, 2), (1, 2), /* <right, bottom> */ (2, 0), (2, 1), (2, 2),
        (0, 3), (1, 3), (2, 3), /* <right, bottom> */ (3, 0), (3, 1), (3, 2), (3, 3),
    ]);
}
