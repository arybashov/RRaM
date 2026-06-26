import os
from PIL import Image, ImageDraw

def create_debug_crops(image_path, output_dir):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    img = Image.open(image_path)
    w, h = img.size
    
    # Coordinates of the seams in the 90-deg rotated final image (v3)
    # The stitching logic was:
    # Row1: [p3][p1], Row2: [p4][p2]
    # Then rotated 90 CCW.
    # In the rotated image:
    # Top-Left: p1, Top-Right: p2
    # Bottom-Left: p3, Bottom-Right: p4
    # (Actually rotation depends on how PIL handles it, but let's just find the center)
    
    cx, cy = w // 2, h // 2
    crop_size = 400
    
    # 1. Central intersection (where all 4 parts meet)
    img.crop((cx - crop_size//2, cy - crop_size//2, cx + crop_size//2, cy + crop_size//2)).save(f"{output_dir}/seam_center.png")
    
    # 2. Horizontal seam (top)
    img.crop((cx - crop_size//2, crop_size, cx + crop_size//2, crop_size*2)).save(f"{output_dir}/seam_horiz_top.png")
    
    # 3. Horizontal seam (bottom)
    img.crop((cx - crop_size//2, h - crop_size*2, cx + crop_size//2, h - crop_size)).save(f"{output_dir}/seam_horiz_bottom.png")
    
    # 4. Vertical seam (left)
    img.crop((crop_size, cy - crop_size//2, crop_size*2, cy + crop_size//2)).save(f"{output_dir}/seam_vert_left.png")
    
    # 5. Vertical seam (right)
    img.crop((w - crop_size*2, cy - crop_size//2, w - crop_size, cy + crop_size//2)).save(f"{output_dir}/seam_vert_right.png")
    
    print(f"Debug crops saved to {output_dir}")

create_debug_crops('Doc/PnP_Map_Full_Final_v3.png', 'debug_seams')
