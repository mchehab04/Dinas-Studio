# Product image upload

**Goal:** Let the store owner put photos on a product from the admin panel. Today `apiService.addProduct()` never sets `images`, so anything published through "Add Piece" gets `[]` and renders the gradient placeholder forever — the only way to attach a photo is to edit rows in the Supabase dashboard.

**Architecture:** Photos are resized and converted to WebP **in the browser** before upload, then stored in a public Supabase Storage bucket. The product row keeps holding an array of image URLs, so nothing about how products render has to change.

## Non-goals

- Cropping, rotation, filters, or any editing beyond resize.
- Drag-to-reorder. Selection order is the order; the first photo is the grid thumbnail.
- Server-side or CDN image transforms — Supabase's are a paid feature, and doing it client-side costs nothing.
- Cleaning up orphaned uploads. If a publish fails after photos upload, those files linger. At this volume that is cheaper than the bookkeeping to prevent it.
- Migrating the existing 17 products. They keep their repo-hosted JPEGs; the new Inventory editor lets them be moved across gradually.

## Why resize in the browser

A browse currently pulls **4.1 MB**, almost entirely images averaging 213 KB, displayed in grid cards about 180px wide. Uploading originals untouched would make that worse with every piece added. Converting before upload means the pipeline that unblocks the admin form is also the one that fixes the payload problem, rather than something to redo later.

Two variants are produced per photo, sized against what the layout actually displays at 2× rather than round numbers — grid cards are about 180px wide, and the detail gallery is 38vh, roughly 320px tall on a phone:

| Variant | Long edge | Quality | Used by |
|---|---|---|---|
| `-sm` | 500px | 0.78 | grid cards, cart and wishlist thumbnails |
| `-lg` | 900px | 0.80 | product detail gallery |

Measured on the existing catalogue: a 451 KB source becomes **206 KB** at `-lg` and **67 KB** at `-sm`. Since the grid loads only `-sm`, that is roughly a 70% cut to the 4.1 MB browse once products are migrated.

Quality stays at 0.8 rather than going lower. Dropping `-lg` to 0.72 saves a further 38 KB, but this is a fashion catalogue where crinkled cotton and silk jacquard texture *is* the product, and fabric detail is the first thing aggressive WebP smears.

Note the existing photos are already modest (960×1280, 1279×1600), so `-lg` barely downscales them and most of its saving comes from re-encoding. The meaningful win is `-sm` in the grid, where 17 images load.

## Storage

Bucket `product-images`, **public read** — these are storefront photos, and a public bucket means plain URLs with no signing.

Writes are admin-only, reusing the `public.is_admin()` helper already written for the RLS fix, so "who is an admin" has exactly one definition in the database:

```sql
create policy "product_images_write_admin"
  on storage.objects for all
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
```

**Paths:** `<folder>/<index>-<sm|lg>.webp`, where `<folder>` is the product id for an existing piece, or a client-generated UUID for a new one. The UUID avoids a chicken-and-egg problem: a new product has no id until it is inserted, but the insert needs the image URLs.

## Data shape

`products.images` stays a JSON array of strings, holding the **`-lg` URLs**. Nothing about the column changes, so `productMedia()` keeps working untouched for products that have not been migrated.

The `-sm` variant is found by swapping the suffix, in one helper rather than inline at each call site. When a URL does not match the convention — every existing seeded product, which points at `data/images/*.jpg` — the helper returns no `srcset` and the image renders exactly as it does today.

## Upload flow

1. Admin picks up to 4 files (`accept="image/*"`, `multiple`).
2. Anything over 10 MB, or not an image, is rejected before processing with a message naming the file.
3. Each file: `createImageBitmap` → draw to a canvas at each target size, preserving aspect ratio and never upscaling → `canvas.toBlob('image/webp', 0.82)`.
4. Both variants upload to Storage.
5. The publish button is disabled while uploading and shows progress; a failure names the file that failed and leaves the form filled in so the work is not lost.

Previews come from the processed blobs, not the originals, so what the admin sees is what visitors get.

## Surfaces

**Add Piece** — a photo picker above the existing fields, with thumbnails and a remove control on each. Publishing without photos stays allowed (the gradient placeholder is a valid look), but is no longer the only outcome.

**Inventory** — each piece gains a Photos control opening the same picker, pre-loaded with its current images, allowing add and remove. This is also the only route for moving the existing 17 onto the new pipeline.

## Error handling

- A Storage rejection for a non-admin is already prevented by the UI, but the policy is what actually enforces it; a rejection surfaces as an inline error rather than a silent failure.
- If some photos upload and a later one fails, the earlier ones stay in Storage as orphans and the admin can retry. The product row is only written once all uploads succeed, so a product is never published with a partial gallery.
- `createImageBitmap` failing (a corrupt or unsupported file) reports that file by name and leaves the rest untouched.

## Setup steps (one-time, human)

1. Run `supabase/product-images-bucket.sql` in the SQL editor — creates the bucket and its policies.
2. Confirm in Storage that `product-images` exists and is marked public.

## Verification

- A non-admin session cannot upload: the Storage call is rejected by policy, not merely hidden by the UI.
- Publishing a new piece with 2 photos shows it in the grid and swipes between both on the detail view.
- The uploaded WebP is materially smaller than the source JPEG, and the `-sm` variant is smaller again.
- Replacing a photo on an existing product updates it for a signed-out visitor in another browser, proving it reached the shared bucket.
- A product still pointing at `data/images/*.jpg` renders unchanged, with no broken `srcset`.
- Removing every photo falls back to the gradient placeholder rather than a broken image.
