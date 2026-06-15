from PIL import Image
import os

def generate_android_icons():
    icon_path = 'icon.jpeg'
    if not os.path.exists(icon_path):
        print(f"Error: Source icon not found at {icon_path}")
        return

    img = Image.open(icon_path)
    resolutions = {
        'mipmap-mdpi': 48,
        'mipmap-hdpi': 72,
        'mipmap-xhdpi': 96,
        'mipmap-xxhdpi': 144,
        'mipmap-xxxhdpi': 192
    }

    try:
        resample_method = Image.Resampling.LANCZOS
    except AttributeError:
        resample_method = Image.LANCZOS

    for folder, res in resolutions.items():
        dest_dir = f'android/app/src/main/res/{folder}'
        os.makedirs(dest_dir, exist_ok=True)
        
        # Resize image using high-quality Lanczos scaling
        resized = img.resize((res, res), resample_method)
        
        # Save both square launcher and rounded launcher icons as PNG
        resized.save(f'{dest_dir}/ic_launcher.png', 'PNG')
        resized.save(f'{dest_dir}/ic_launcher_round.png', 'PNG')
        print(f"Generated icons in {folder} ({res}x{res})")

    print("App icons successfully generated from icon.jpeg!")

if __name__ == '__main__':
    generate_android_icons()
